<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/gemini.php';

dpc_require_auth();
dpc_require_method('POST');

$body = dpc_read_json_body();
$image = $body['imageBase64'] ?? null;
$mediaType = $body['mediaType'] ?? null;

if (!is_string($image) || $image === '' || !is_string($mediaType) || $mediaType === '') {
    dpc_send_error('imageBase64 and mediaType are required', 400);
}

try {
    dpc_send_json(gemini_identify_record($image, $mediaType));
} catch (Throwable $e) {
    dpc_send_error($e->getMessage(), 500);
}
