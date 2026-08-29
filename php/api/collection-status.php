<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/discogs.php';

dpc_require_auth();

$releaseIds = dpc_release_ids_param();
if ($releaseIds === []) {
    dpc_send_json(['owned' => (object) []]);
}

try {
    $counts = discogs_collection_counts(discogs_username(), $releaseIds);
    dpc_send_json(['owned' => $counts === [] ? (object) [] : $counts]);
} catch (Throwable $e) {
    // Ownership is a non-critical enrichment; the UI degrades quietly.
    dpc_send_json(['owned' => (object) [], 'error' => $e->getMessage()]);
}
