<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/discogs.php';

dpc_require_auth();

$barcode = trim((string) ($_GET['barcode'] ?? ''));

try {
    if ($barcode !== '') {
        $results = discogs_search_by_barcode($barcode);
    } else {
        $results = discogs_search_by_query([
            'q' => (string) ($_GET['q'] ?? ''),
            'artist' => (string) ($_GET['artist'] ?? ''),
            'release_title' => (string) ($_GET['release_title'] ?? ''),
            'label' => (string) ($_GET['label'] ?? ''),
            'catno' => (string) ($_GET['catno'] ?? ''),
        ]);
    }
    dpc_send_json(['results' => $results]);
} catch (Throwable $e) {
    dpc_send_error($e->getMessage(), 500);
}
