<?php
// Convenience entry for local Apache/Vertrigo. Vercel serves public/index.html instead.
if (!in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
    http_response_code(404);
    exit;
}
$port = getenv('REQUEST_WEB_PORT');
if ($port === false && is_file(__DIR__ . '/.env')) {
    foreach (file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES) as $line) {
        if (preg_match('/^\s*REQUEST_WEB_PORT\s*=\s*(\d+)\s*$/', $line, $matches)) {
            $port = $matches[1];
        }
    }
}
$port = filter_var($port === false ? '5178' : $port, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1024, 'max_range' => 65535]]);
if ($port === false) {
    http_response_code(500);
    echo 'The local frontend port is not configured correctly.';
    exit;
}
header('Cache-Control: no-store');
header('Location: http://127.0.0.1:' . $port . '/', true, 302);
exit;