<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/discogs.php';

dpc_require_auth();

$releaseIds = dpc_release_ids_param();
if ($releaseIds === []) {
    dpc_send_json(['prices' => (object) []]);
}

try {
    $prices = discogs_price_stats_many($releaseIds);
    dpc_send_json(['prices' => $prices === [] ? (object) [] : $prices]);
} catch (Throwable $e) {
    dpc_send_json(['prices' => (object) [], 'error' => $e->getMessage()]);
}
