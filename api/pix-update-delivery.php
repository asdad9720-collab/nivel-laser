<?php
/**
 * PIX API - Atualizar Status de Entrega (FuriaPay)
 */

// Desabilita exibicao de erros
error_reporting(0);
ini_set('display_errors', 0);

// Headers
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'PUT') {
    echo json_encode(['error' => 'Metodo nao permitido']);
    exit;
}

try {
    // Carrega credenciais (se existir)
    $configPath = __DIR__ . '/../config/pix-credentials.php';
    if (file_exists($configPath)) {
        @include_once $configPath;
    }

    // Credenciais FuriaPay (prioriza env vars; fallback para constants)
    $FURIAPAY_PUBLIC_KEY = getenv('FURIAPAY_PUBLIC_KEY');
    $FURIAPAY_SECRET_KEY = getenv('FURIAPAY_SECRET_KEY');
    $FURIAPAY_DELIVERY_URL_TEMPLATE = getenv('FURIAPAY_DELIVERY_URL_TEMPLATE');

    if (defined('FURIAPAY_PUBLIC_KEY') && !$FURIAPAY_PUBLIC_KEY) {
        $FURIAPAY_PUBLIC_KEY = FURIAPAY_PUBLIC_KEY;
    }
    if (defined('FURIAPAY_SECRET_KEY') && !$FURIAPAY_SECRET_KEY) {
        $FURIAPAY_SECRET_KEY = FURIAPAY_SECRET_KEY;
    }
    if (defined('FURIAPAY_DELIVERY_URL_TEMPLATE') && !$FURIAPAY_DELIVERY_URL_TEMPLATE) {
        $FURIAPAY_DELIVERY_URL_TEMPLATE = FURIAPAY_DELIVERY_URL_TEMPLATE;
    }

    if (empty($FURIAPAY_PUBLIC_KEY) || empty($FURIAPAY_SECRET_KEY)) {
        throw new Exception('Credenciais FuriaPay nao configuradas');
    }

    $input = file_get_contents('php://input');
    $data = json_decode($input, true);

    if (!$data) {
        throw new Exception('JSON invalido');
    }

    $transactionId = isset($data['id']) ? trim($data['id']) : '';
    $status = isset($data['status']) ? trim($data['status']) : '';
    $trackingCode = isset($data['trackingCode']) ? trim($data['trackingCode']) : '';

    if (empty($transactionId)) {
        throw new Exception('ID da transacao e obrigatorio');
    }

    if (empty($status)) {
        throw new Exception('Status e obrigatorio');
    }

    // Autenticacao
    $auth = base64_encode("{$FURIAPAY_PUBLIC_KEY}:{$FURIAPAY_SECRET_KEY}");

    // Endpoint de delivery (FuriaPay). Pode sobrescrever via env/const.
    if (empty($FURIAPAY_DELIVERY_URL_TEMPLATE)) {
        $FURIAPAY_DELIVERY_URL_TEMPLATE = 'https://api.furiapaybr.app/v1/payment-transaction/delivery/{id}';
    }
    $apiUrl = str_replace('{id}', urlencode($transactionId), $FURIAPAY_DELIVERY_URL_TEMPLATE);

    // Payload
    $payload = [
        'status' => $status
    ];
    if ($trackingCode !== '') {
        $payload['tracking_code'] = $trackingCode;
    }

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $apiUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => 'PUT',
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Basic ' . $auth
        ],
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT => 30
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        throw new Exception('Erro de conexao: ' . $curlError);
    }

    $responseData = json_decode($response, true);

    if ($httpCode >= 200 && $httpCode < 300) {
        echo json_encode([
            'success' => true,
            'message' => 'Status atualizado',
            'data' => $responseData
        ]);
    } else {
        $errorMsg = $responseData['message'] ?? $responseData['error'] ?? 'Erro desconhecido';
        http_response_code($httpCode);
        echo json_encode(['success' => false, 'error' => $errorMsg]);
    }

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
