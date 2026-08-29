<?php
/**
 * Gemini vision identification — a port of lib/gemini.ts.
 *
 * The @google/genai SDK has no PHP equivalent, so this calls the v1beta REST
 * endpoint directly. The system prompt, response schema and the text/barcode
 * sanitizers are kept faithful to the original so identification behaves the
 * same as it does on the Workers deployment.
 */

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const GEMINI_SYSTEM_PROMPT = <<<'TXT'
You identify vinyl/CD records from a photo of their sleeve, cover, or label for lookup on Discogs.
Read any visible text (artist, album/release title, label name, catalogue number, barcode, year/pressing info).
If you cannot read something, use null for that field. "confidence" reflects how sure you are of the artist+title.
TXT;

class GeminiException extends RuntimeException
{
}

/**
 * Discogs search fields don't handle stray punctuation/symbols well (quotes,
 * asterisks, em-dashes, etc. that vision OCR sometimes emits), so strip
 * anything that isn't a letter, number, or space before it's used to query.
 */
function gemini_sanitize_text(?string $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    $cleaned = preg_replace('/[^\p{L}\p{N}\s]/u', ' ', $value);
    $cleaned = preg_replace('/\s+/u', ' ', (string) $cleaned);
    $cleaned = trim((string) $cleaned);
    return $cleaned !== '' ? $cleaned : null;
}

function gemini_sanitize_barcode(?string $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    $cleaned = preg_replace('/[^0-9A-Za-z]/', '', $value);
    return ($cleaned !== null && $cleaned !== '') ? $cleaned : null;
}

/** @return array<string, mixed> */
function gemini_response_schema(): array
{
    // REST wants upper-case type names; the JS SDK lower-cases them for you.
    $nullableString = ['type' => 'STRING', 'nullable' => true];

    return [
        'type' => 'OBJECT',
        'properties' => [
            'artist' => $nullableString,
            'title' => $nullableString,
            'format' => $nullableString,
            'year' => $nullableString,
            'label' => $nullableString,
            'catalogNumber' => $nullableString,
            'barcode' => $nullableString,
            'confidence' => ['type' => 'STRING', 'enum' => ['high', 'medium', 'low']],
            'notes' => $nullableString,
        ],
        'required' => ['confidence'],
    ];
}

/**
 * @return array<string, mixed>  the IdentifiedRecord shape the front end expects
 * @throws GeminiException
 */
function gemini_identify_record(string $base64Image, string $mediaType): array
{
    $apiKey = dpc_config_value('gemini_api_key');
    if ($apiKey === '') {
        throw new GeminiException('GEMINI_API_KEY is not set in discogs-config.php.');
    }

    $allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!in_array($mediaType, $allowedTypes, true)) {
        throw new GeminiException('Unsupported image type: ' . $mediaType);
    }

    $model = dpc_config_value('gemini_model');
    if ($model === '') {
        $model = 'gemini-3.6-flash';
    }

    $payload = [
        'systemInstruction' => ['parts' => [['text' => GEMINI_SYSTEM_PROMPT]]],
        'contents' => [[
            'role' => 'user',
            'parts' => [
                ['inlineData' => ['mimeType' => $mediaType, 'data' => $base64Image]],
                ['text' => 'Identify this record and return the JSON object described in your instructions.'],
            ],
        ]],
        'generationConfig' => [
            'responseMimeType' => 'application/json',
            'responseSchema' => gemini_response_schema(),
        ],
    ];

    $url = GEMINI_API_BASE . '/models/' . rawurlencode($model) . ':generateContent';

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            // Key in a header, not the query string, so it stays out of logs.
            'x-goog-api-key: ' . $apiKey,
        ],
        CURLOPT_TIMEOUT => 90,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);

    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        throw new GeminiException('Could not reach Gemini: ' . $curlError);
    }

    $decoded = json_decode((string) $body, true);

    if ($status < 200 || $status >= 300) {
        $message = $decoded['error']['message'] ?? substr((string) $body, 0, 300);
        throw new GeminiException("Gemini API error {$status}: " . $message);
    }

    $text = $decoded['candidates'][0]['content']['parts'][0]['text'] ?? null;
    if (!is_string($text) || $text === '') {
        // A blocked prompt returns a candidate with no parts — say so usefully.
        $reason = $decoded['candidates'][0]['finishReason']
            ?? $decoded['promptFeedback']['blockReason']
            ?? null;
        throw new GeminiException(
            'No text response from Gemini' . ($reason ? " (finishReason: {$reason})" : '')
        );
    }

    $parsed = json_decode($text, true);
    if (!is_array($parsed)) {
        throw new GeminiException('Could not parse Gemini response as JSON: ' . substr($text, 0, 200));
    }

    $strOrNull = static function ($v): ?string {
        return is_string($v) && $v !== '' ? $v : null;
    };

    return [
        'artist' => gemini_sanitize_text($strOrNull($parsed['artist'] ?? null)),
        'title' => gemini_sanitize_text($strOrNull($parsed['title'] ?? null)),
        'format' => gemini_sanitize_text($strOrNull($parsed['format'] ?? null)),
        'year' => gemini_sanitize_text($strOrNull($parsed['year'] ?? null)),
        'label' => gemini_sanitize_text($strOrNull($parsed['label'] ?? null)),
        'catalogNumber' => gemini_sanitize_text($strOrNull($parsed['catalogNumber'] ?? null)),
        'barcode' => gemini_sanitize_barcode($strOrNull($parsed['barcode'] ?? null)),
        'confidence' => $strOrNull($parsed['confidence'] ?? null) ?? 'low',
        'notes' => $strOrNull($parsed['notes'] ?? null),
    ];
}

/**
 * Lists the models the configured key can actually reach. The original project
 * was bitten twice by pinned/aliased models disappearing, so this is exposed
 * as a diagnostic endpoint rather than kept as a manual curl.
 *
 * @return array<int, string>
 */
function gemini_available_models(): array
{
    $apiKey = dpc_config_value('gemini_api_key');
    if ($apiKey === '') {
        throw new GeminiException('GEMINI_API_KEY is not set in discogs-config.php.');
    }

    $ch = curl_init(GEMINI_API_BASE . '/models');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['x-goog-api-key: ' . $apiKey],
        CURLOPT_TIMEOUT => 30,
    ]);
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $status < 200 || $status >= 300) {
        throw new GeminiException('Could not list Gemini models (HTTP ' . $status . ').');
    }

    $decoded = json_decode((string) $body, true);
    $names = [];
    foreach ($decoded['models'] ?? [] as $model) {
        $name = (string) ($model['name'] ?? '');
        $methods = $model['supportedGenerationMethods'] ?? [];
        if ($name !== '' && (!is_array($methods) || in_array('generateContent', $methods, true))) {
            $names[] = preg_replace('#^models/#', '', $name);
        }
    }
    return $names;
}
