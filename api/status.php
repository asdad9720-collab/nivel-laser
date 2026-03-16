<?php
/**
 * Status API - Sistema OK
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

echo json_encode([
    'status' => 'ok',
    'timestamp' => date('c'),
    'php_version' => PHP_VERSION,
    'memory' => round(memory_get_usage() / 1024 / 1024, 2) . ' MB'
]);
