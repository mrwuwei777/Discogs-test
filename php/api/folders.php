<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/discogs.php';

dpc_require_auth();

try {
    $username = discogs_username();
    dpc_send_json(['username' => $username, 'folders' => discogs_folders($username)]);
} catch (Throwable $e) {
    dpc_send_error($e->getMessage(), 500);
}
