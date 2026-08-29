<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/discogs.php';

dpc_require_auth();
dpc_require_method('POST');

$body = dpc_read_json_body();
$releaseId = $body['releaseId'] ?? null;

if (!is_numeric($releaseId) || (int) $releaseId <= 0) {
    dpc_send_error('releaseId is required', 400);
}

$folderId = isset($body['folderId']) && is_numeric($body['folderId']) ? (int) $body['folderId'] : 1;

try {
    discogs_add_to_collection(discogs_username(), (int) $releaseId, $folderId);
    dpc_send_json(['success' => true]);
} catch (Throwable $e) {
    dpc_send_error($e->getMessage(), 500);
}
