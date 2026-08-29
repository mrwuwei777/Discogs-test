<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/discogs.php';

dpc_require_auth();

$id = (string) ($_GET['id'] ?? '');
if ($id === '' || !ctype_digit($id)) {
    dpc_send_error('A numeric release id is required', 400);
}

try {
    dpc_send_json(discogs_release((int) $id));
} catch (Throwable $e) {
    dpc_send_error($e->getMessage(), 500);
}
