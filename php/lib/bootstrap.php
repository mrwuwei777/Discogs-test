<?php
/**
 * Shared bootstrap: config loading, auth gate, JSON helpers, tiny file cache.
 * Targets PHP 8.0 (the version on the 20i web nodes) — no 8.1+ syntax.
 */

declare(strict_types=1);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Secrets live outside the web root so a PHP-handler misconfiguration can
 * never serve them as plain text. Override with DISCOGS_CONFIG if needed.
 */
function dpc_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $candidates = [
        getenv('DISCOGS_CONFIG') ?: null,
        dirname(__DIR__, 3) . '/discogs-config.php', // ~/discogs-config.php when installed at ~/public_html/discogs
        dirname(__DIR__) . '/config.php',            // local dev fallback
    ];

    foreach ($candidates as $path) {
        if ($path && is_file($path)) {
            /** @var array $loaded */
            $loaded = require $path;
            if (is_array($loaded)) {
                $config = $loaded + dpc_defaults();
                return $config;
            }
        }
    }

    $config = dpc_defaults();
    return $config;
}

function dpc_defaults(): array
{
    return [
        'discogs_token' => '',
        'discogs_username' => '',
        'gemini_api_key' => '',
        'gemini_model' => 'gemini-3.6-flash',
        'auth_user' => '',
        'auth_password_hash' => '',
        'cache_dir' => '',
    ];
}

function dpc_config_value(string $key, string $default = ''): string
{
    $config = dpc_config();
    $value = $config[$key] ?? $default;
    return is_string($value) ? $value : $default;
}

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

/**
 * HTTP Basic auth, enforced in PHP rather than via Apache's AuthUserFile so it
 * works regardless of what AllowOverride the shared host grants us.
 *
 * The app writes to a real Discogs collection and spends a real Gemini quota
 * with a single personal token, so an unauthenticated public URL would let any
 * passer-by mutate the collection. No credentials configured = gate disabled.
 */
function dpc_require_auth(): void
{
    $user = dpc_config_value('auth_user');
    $hash = dpc_config_value('auth_password_hash');
    if ($user === '' || $hash === '') {
        return; // Gate not configured — run open.
    }

    [$givenUser, $givenPass] = dpc_basic_credentials();

    $userOk = $givenUser !== null && hash_equals($user, $givenUser);
    $passOk = $givenPass !== null && password_verify($givenPass, $hash);

    if ($userOk && $passOk) {
        return;
    }

    header('WWW-Authenticate: Basic realm="Discogs Photo Collector", charset="UTF-8"');
    header('Cache-Control: no-store');
    http_response_code(401);
    if (dpc_wants_json()) {
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Authentication required']);
    } else {
        header('Content-Type: text/plain; charset=utf-8');
        echo "Authentication required.\n";
    }
    exit;
}

/**
 * PHP-FPM does not populate PHP_AUTH_* on its own — the Authorization header
 * has to be recovered from whatever mod_rewrite/CGI passed through.
 *
 * @return array{0: ?string, 1: ?string}
 */
function dpc_basic_credentials(): array
{
    if (isset($_SERVER['PHP_AUTH_USER'])) {
        return [(string) $_SERVER['PHP_AUTH_USER'], (string) ($_SERVER['PHP_AUTH_PW'] ?? '')];
    }

    $header = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_REMOTE_USER']
        ?? '';

    if (is_string($header) && stripos($header, 'basic ') === 0) {
        $decoded = base64_decode(substr($header, 6), true);
        if ($decoded !== false && strpos($decoded, ':') !== false) {
            [$u, $p] = explode(':', $decoded, 2);
            return [$u, $p];
        }
    }

    return [null, null];
}

function dpc_wants_json(): bool
{
    return strpos((string) ($_SERVER['SCRIPT_NAME'] ?? ''), '/api/') !== false;
}

// ---------------------------------------------------------------------------
// JSON request/response helpers
// ---------------------------------------------------------------------------

function dpc_json_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    // This app is per-user and mutates state; never let the CDN cache it.
    header('Cache-Control: no-store, no-cache, must-revalidate');
}

/** @param mixed $data */
function dpc_send_json($data, int $status = 200): void
{
    dpc_json_headers();
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function dpc_send_error(string $message, int $status = 500): void
{
    dpc_send_json(['error' => $message], $status);
}

/** @return array<string, mixed> */
function dpc_read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function dpc_require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== $method) {
        dpc_send_error('Method not allowed', 405);
    }
}

/**
 * Parses the comma-separated releaseIds query param shared by the
 * collection-status and price-status endpoints.
 *
 * @return int[]
 */
function dpc_release_ids_param(): array
{
    $raw = (string) ($_GET['releaseIds'] ?? '');
    if ($raw === '') {
        return [];
    }
    $ids = [];
    foreach (explode(',', $raw) as $part) {
        $part = trim($part);
        if ($part !== '' && ctype_digit($part)) {
            $ids[] = (int) $part;
        }
    }
    return array_values(array_unique($ids));
}

// ---------------------------------------------------------------------------
// File cache
// ---------------------------------------------------------------------------

/**
 * Discogs allows 60 authenticated requests/minute. A single search can return
 * dozens of results, each needing an ownership check and a price lookup, so
 * repeat lookups are cached on disk to stay well inside that budget.
 */
function dpc_cache_dir(): ?string
{
    static $dir = null;
    static $resolved = false;
    if ($resolved) {
        return $dir;
    }
    $resolved = true;

    $configured = dpc_config_value('cache_dir');
    $candidate = $configured !== '' ? $configured : dirname(__DIR__, 3) . '/discogs-cache';

    if (!is_dir($candidate) && !@mkdir($candidate, 0700, true) && !is_dir($candidate)) {
        $dir = null;
        return $dir;
    }

    $dir = is_writable($candidate) ? $candidate : null;
    return $dir;
}

/** @return mixed null when absent or stale */
function dpc_cache_get(string $key, int $ttlSeconds)
{
    $dir = dpc_cache_dir();
    if ($dir === null) {
        return null;
    }
    $file = $dir . '/' . hash('sha256', $key) . '.json';
    if (!is_file($file) || (time() - (int) @filemtime($file)) > $ttlSeconds) {
        return null;
    }
    $raw = @file_get_contents($file);
    if ($raw === false) {
        return null;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) && array_key_exists('v', $decoded) ? $decoded['v'] : null;
}

/** @param mixed $value */
function dpc_cache_set(string $key, $value): void
{
    $dir = dpc_cache_dir();
    if ($dir === null) {
        return;
    }
    $file = $dir . '/' . hash('sha256', $key) . '.json';
    $tmp = $file . '.' . getmypid() . '.tmp';
    $encoded = json_encode(['v' => $value], JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        return;
    }
    // Write-then-rename so a concurrent reader never sees a half-written file.
    if (@file_put_contents($tmp, $encoded, LOCK_EX) !== false) {
        @rename($tmp, $file);
    }
}
