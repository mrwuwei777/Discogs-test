<?php
/**
 * Discogs API client — a port of lib/discogs.ts.
 *
 * Differences from the TypeScript original, both forced by the runtime:
 *  - Promise.all over N releases becomes curl_multi with a bounded window,
 *    so the batch endpoints stay fast without tripping the rate limit.
 *  - Results are cached on disk (see dpc_cache_* in bootstrap.php).
 */

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

const DISCOGS_API = 'https://api.discogs.com';
const DISCOGS_USER_AGENT = 'DiscogsPhotoCollector/0.1 (+https://github.com/mrwuwei777/Discogs-test)';

/** Discogs permits 60 authenticated requests/minute; stay comfortably under. */
const DISCOGS_MAX_CONCURRENCY = 5;

const CACHE_TTL_RELEASE = 604800;   // 7 days  — release detail is ~immutable
const CACHE_TTL_PRICE = 86400;      // 24 hours — suggestions drift slowly
const CACHE_TTL_IDENTITY = 86400;   // 24 hours

class DiscogsException extends RuntimeException
{
}

function discogs_token(): string
{
    $token = dpc_config_value('discogs_token');
    if ($token === '') {
        throw new DiscogsException('DISCOGS_TOKEN is not set in discogs-config.php.');
    }
    return $token;
}

function discogs_url(string $path): string
{
    return strpos($path, 'http') === 0 ? $path : DISCOGS_API . $path;
}

/** @return array<int, string> */
function discogs_headers(): array
{
    return [
        'Authorization: Discogs token=' . discogs_token(),
        'User-Agent: ' . DISCOGS_USER_AGENT,
        'Accept: application/json',
    ];
}

/**
 * @return array<string, mixed>
 * @throws DiscogsException
 */
function discogs_fetch(string $path, string $method = 'GET'): array
{
    $ch = curl_init(discogs_url($path));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => discogs_headers(),
        CURLOPT_TIMEOUT => 25,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_FOLLOWLOCATION => true,
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, '');
    }

    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        throw new DiscogsException('Could not reach Discogs: ' . $curlError);
    }
    if ($status < 200 || $status >= 300) {
        throw new DiscogsException("Discogs API error {$status}: " . substr((string) $body, 0, 300));
    }

    $decoded = json_decode((string) $body, true);
    if (!is_array($decoded)) {
        throw new DiscogsException('Discogs returned a response that was not JSON.');
    }
    return $decoded;
}

/**
 * Runs several GETs concurrently in bounded windows.
 *
 * @param array<string|int, string> $paths  key => path
 * @return array<string|int, array<string, mixed>|null>  null for any failure
 */
function discogs_fetch_many(array $paths): array
{
    $results = [];
    foreach (array_chunk($paths, DISCOGS_MAX_CONCURRENCY, true) as $chunk) {
        $multi = curl_multi_init();
        $handles = [];

        foreach ($chunk as $key => $path) {
            $ch = curl_init(discogs_url($path));
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => discogs_headers(),
                CURLOPT_TIMEOUT => 20,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_FOLLOWLOCATION => true,
            ]);
            curl_multi_add_handle($multi, $ch);
            $handles[$key] = $ch;
        }

        do {
            $status = curl_multi_exec($multi, $running);
            if ($running) {
                curl_multi_select($multi, 1.0);
            }
        } while ($running && $status === CURLM_OK);

        foreach ($handles as $key => $ch) {
            $body = curl_multi_getcontent($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $decoded = ($code >= 200 && $code < 300 && is_string($body)) ? json_decode($body, true) : null;
            $results[$key] = is_array($decoded) ? $decoded : null;
            curl_multi_remove_handle($multi, $ch);
            curl_close($ch);
        }

        curl_multi_close($multi);
    }

    return $results;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** @return array<int, array<string, mixed>> */
function discogs_search_by_barcode(string $barcode): array
{
    $query = http_build_query(['barcode' => $barcode, 'type' => 'release', 'format' => 'Vinyl']);
    $data = discogs_fetch('/database/search?' . $query);
    return is_array($data['results'] ?? null) ? $data['results'] : [];
}

/**
 * @param array<string, string> $params  q, artist, release_title, label, catno
 * @return array<int, array<string, mixed>>
 */
function discogs_search_by_query(array $params): array
{
    $search = ['type' => 'release', 'format' => 'Vinyl'];
    foreach (['q', 'artist', 'release_title', 'label', 'catno'] as $field) {
        $value = trim((string) ($params[$field] ?? ''));
        if ($value !== '') {
            $search[$field] = $value;
        }
    }
    $data = discogs_fetch('/database/search?' . http_build_query($search));
    return is_array($data['results'] ?? null) ? $data['results'] : [];
}

// ---------------------------------------------------------------------------
// Identity / folders
// ---------------------------------------------------------------------------

function discogs_username(): string
{
    $configured = dpc_config_value('discogs_username');
    if ($configured !== '') {
        return $configured;
    }

    $cached = dpc_cache_get('identity', CACHE_TTL_IDENTITY);
    if (is_string($cached) && $cached !== '') {
        return $cached;
    }

    $identity = discogs_fetch('/oauth/identity');
    $username = (string) ($identity['username'] ?? '');
    if ($username === '') {
        throw new DiscogsException('Could not determine the Discogs username from the token.');
    }
    dpc_cache_set('identity', $username);
    return $username;
}

/** @return array<int, array<string, mixed>> */
function discogs_folders(string $username): array
{
    $data = discogs_fetch('/users/' . rawurlencode($username) . '/collection/folders');
    return is_array($data['folders'] ?? null) ? $data['folders'] : [];
}

// ---------------------------------------------------------------------------
// Release detail
// ---------------------------------------------------------------------------

/** @return array<string, mixed> */
function discogs_release(int $releaseId): array
{
    $cacheKey = "release:{$releaseId}";
    $cached = dpc_cache_get($cacheKey, CACHE_TTL_RELEASE);
    if (is_array($cached)) {
        return $cached;
    }

    $release = discogs_fetch('/releases/' . $releaseId);
    dpc_cache_set($cacheKey, $release);
    return $release;
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * How many copies of each release are already in the collection.
 * Never cached: it has to reflect an add made seconds ago.
 *
 * @param int[] $releaseIds
 * @return array<int, int>
 */
function discogs_collection_counts(string $username, array $releaseIds): array
{
    if ($releaseIds === []) {
        return [];
    }

    $paths = [];
    foreach ($releaseIds as $id) {
        $paths[$id] = '/users/' . rawurlencode($username) . '/collection/releases/' . $id;
    }

    $counts = [];
    foreach (discogs_fetch_many($paths) as $id => $data) {
        // A 404 (not in collection) decodes to null — that is a zero, not an error.
        $releases = is_array($data) && is_array($data['releases'] ?? null) ? $data['releases'] : [];
        $counts[(int) $id] = count($releases);
    }
    return $counts;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Discogs exposes no sold-price median/high stat, so these are derived from
 * the per-condition price_suggestions payload, exactly as the original did.
 *
 * @param array<string, mixed>|null $data
 * @return array{currency: string, median: float, high: float}|null
 */
function discogs_derive_price_stats($data): ?array
{
    if (!is_array($data) || $data === []) {
        return null;
    }

    $values = [];
    $currency = '';
    foreach ($data as $entry) {
        if (is_array($entry) && isset($entry['value']) && is_numeric($entry['value'])) {
            $values[] = (float) $entry['value'];
            if ($currency === '' && isset($entry['currency'])) {
                $currency = (string) $entry['currency'];
            }
        }
    }
    if ($values === []) {
        return null;
    }

    sort($values);
    $count = count($values);
    $mid = intdiv($count, 2);
    $median = $count % 2 === 0 ? ($values[$mid - 1] + $values[$mid]) / 2 : $values[$mid];

    return [
        'currency' => $currency !== '' ? $currency : 'USD',
        'median' => $median,
        'high' => $values[$count - 1],
    ];
}

/**
 * @param int[] $releaseIds
 * @return array<int, array{currency: string, median: float, high: float}|null>
 */
function discogs_price_stats_many(array $releaseIds): array
{
    if ($releaseIds === []) {
        return [];
    }

    $prices = [];
    $toFetch = [];

    foreach ($releaseIds as $id) {
        $cached = dpc_cache_get("price:{$id}", CACHE_TTL_PRICE);
        if (is_array($cached)) {
            $prices[$id] = $cached;
        } elseif ($cached === 'none') {
            $prices[$id] = null;
        } else {
            $toFetch[$id] = '/marketplace/price_suggestions/' . $id;
        }
    }

    if ($toFetch !== []) {
        foreach (discogs_fetch_many($toFetch) as $id => $data) {
            $stats = discogs_derive_price_stats($data);
            $prices[(int) $id] = $stats;

            // Only cache a successful lookup. A null $data means the request
            // itself failed (e.g. Discogs returns 404 "You must fill out your
            // seller settings first" until seller settings exist) — caching
            // that would keep prices blank for a day after the account is fixed.
            if ($data !== null) {
                dpc_cache_set("price:{$id}", $stats ?? 'none');
            }
        }
    }

    return $prices;
}

// ---------------------------------------------------------------------------
// Collection write
// ---------------------------------------------------------------------------

function discogs_add_to_collection(string $username, int $releaseId, int $folderId = 1): void
{
    discogs_fetch(
        '/users/' . rawurlencode($username) . '/collection/folders/' . $folderId . '/releases/' . $releaseId,
        'POST'
    );
}
