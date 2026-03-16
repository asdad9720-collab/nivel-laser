<?php
/**
 * UTMify API - Sincroniza pedido local com a UTMify
 */

error_reporting(0);
ini_set('display_errors', 0);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Metodo nao permitido']);
    exit;
}

$configPath = __DIR__ . '/../config/utmify.php';
if (file_exists($configPath)) {
    @include_once $configPath;
}
$helperPath = __DIR__ . '/../includes/utmify-sync.php';
if (file_exists($helperPath)) {
    @include_once $helperPath;
}

try {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);

    if (!is_array($data)) {
        throw new Exception('JSON invalido');
    }

    if (!function_exists('cm_sync_utmify_order')) {
        throw new Exception('Helper da UTMify indisponivel');
    }

    $orderId = cm_utmify_trimmed_string($data['orderId'] ?? null);
    if (!$orderId) {
        throw new Exception('orderId e obrigatorio');
    }

    $context = [
        'orderId' => $orderId,
        'status' => $data['status'] ?? 'pending',
        'paymentMethod' => $data['paymentMethod'] ?? 'pix',
        'amountCents' => (int) ($data['amountCents'] ?? 0),
        'createdAt' => $data['createdAt'] ?? null,
        'approvedDate' => $data['approvedDate'] ?? null,
        'customer' => isset($data['customer']) && is_array($data['customer']) ? $data['customer'] : [],
        'product' => isset($data['product']) && is_array($data['product']) ? $data['product'] : [],
        'trackingParameters' => isset($data['trackingParameters']) && is_array($data['trackingParameters']) ? $data['trackingParameters'] : [],
    ];

    $result = cm_sync_utmify_order($context, $data['status'] ?? 'pending');

    echo json_encode([
        'success' => true,
        'message' => 'Pedido enviado para a UTMify',
        'status' => strtolower(trim((string) ($data['status'] ?? 'pending'))),
        'orderId' => $orderId,
        'utmifyResponse' => $result['response']['body'] ?? null
    ]);
} catch (Exception $error) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $error->getMessage()
    ]);
}
