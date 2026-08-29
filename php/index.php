<?php
/**
 * Page shell — the port of app/layout.tsx + app/page.tsx.
 * The interactive flow lives in assets/app.js (port of RecordCapture/ResultCard).
 */
declare(strict_types=1);
require_once __DIR__ . '/lib/bootstrap.php';

dpc_require_auth();

// Cache-bust the static assets on change without hand-editing version strings.
$assetVersion = static function (string $relativePath): string {
    $full = __DIR__ . '/' . $relativePath;
    $stamp = is_file($full) ? (string) filemtime($full) : '0';
    return $relativePath . '?v=' . substr(md5($stamp), 0, 8);
};
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Discogs Photo Collector</title>
<meta name="description" content="Photograph a record and add it to your Discogs collection">
<link rel="stylesheet" href="<?= htmlspecialchars($assetVersion('assets/styles.css'), ENT_QUOTES) ?>">
</head>
<body>
<main>
  <h1>Discogs Photo Collector</h1>
  <p class="subtitle">Photograph a record → find it on Discogs → add it to your collection.</p>
  <div id="app"></div>
</main>

<!-- Vendored locally, not pulled from a CDN: a blocking third-party script
     would stall rendering for anyone the CDN is slow or blocked for. -->
<script src="<?= htmlspecialchars($assetVersion('assets/zxing.min.js'), ENT_QUOTES) ?>" defer></script>
<script src="<?= htmlspecialchars($assetVersion('assets/app.js'), ENT_QUOTES) ?>" defer></script>
</body>
</html>
