<?php
/**
 * Diagnostics: confirms config, credentials and both upstream APIs from the
 * web node itself. Useful because the SSH node cannot reach the web server.
 */
declare(strict_types=1);
require_once __DIR__ . '/../lib/discogs.php';
require_once __DIR__ . '/../lib/gemini.php';

dpc_require_auth();

$report = [
    'php' => PHP_VERSION,
    'host' => gethostname(),
    'config_found' => dpc_config_value('discogs_token') !== '' || dpc_config_value('gemini_api_key') !== '',
    'discogs_token_set' => dpc_config_value('discogs_token') !== '',
    'gemini_key_set' => dpc_config_value('gemini_api_key') !== '',
    'gemini_model' => dpc_config_value('gemini_model'),
    'auth_enabled' => dpc_config_value('auth_user') !== '' && dpc_config_value('auth_password_hash') !== '',
    'cache_dir' => dpc_cache_dir() ?? 'UNAVAILABLE',
];

try {
    $report['discogs_username'] = discogs_username();
    $report['discogs'] = 'ok';
} catch (Throwable $e) {
    $report['discogs'] = 'FAILED: ' . $e->getMessage();
}

try {
    $models = gemini_available_models();
    $configured = dpc_config_value('gemini_model') ?: 'gemini-3.6-flash';
    $report['gemini'] = 'ok';
    $report['gemini_model_available'] = in_array($configured, $models, true);
    $report['gemini_models_sample'] = array_slice($models, 0, 40);
} catch (Throwable $e) {
    $report['gemini'] = 'FAILED: ' . $e->getMessage();
}

dpc_send_json($report);
