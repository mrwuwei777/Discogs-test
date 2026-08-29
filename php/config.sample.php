<?php
/**
 * Copy to ~/discogs-config.php (OUTSIDE public_html) and fill in.
 *
 *   cp config.sample.php ~/discogs-config.php
 *   chmod 600 ~/discogs-config.php
 *
 * Generate the auth password hash with:
 *   php -r 'echo password_hash("your-password", PASSWORD_BCRYPT), "\n";'
 */
return [
    // Discogs personal access token: https://www.discogs.com/settings/developers
    'discogs_token' => '',

    // Optional. Looked up from the token via /oauth/identity when left blank.
    'discogs_username' => '',

    // Google Gemini API key (free tier): https://aistudio.google.com/apikey
    'gemini_api_key' => '',

    // Pinned to a concrete model name — the "-latest" aliases have silently
    // resolved to deprecated models on this project before.
    'gemini_model' => 'gemini-3.6-flash',

    // HTTP Basic auth. Leave both blank to run the app with no gate at all.
    // Strongly recommended: this app writes to a real collection with a single
    // personal token, and it sits on a public domain.
    'auth_user' => '',
    'auth_password_hash' => '',

    // Defaults to ~/discogs-cache when blank.
    'cache_dir' => '',
];
