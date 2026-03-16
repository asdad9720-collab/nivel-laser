<?php
/**
 * PIX API - Informacoes da transacao via nova API de pagamentos
 */

error_reporting(0);
ini_set('display_errors', 0);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    echo json_encode(['error' => 'Metodo nao permitido']);
    exit;
}

try {
    $configPath = __DIR__ . '/../config/pix-credentials.php';
    if (file_exists($configPath)) {
        @include_once $configPath;
    }

    $paymentHelperPath = __DIR__ . '/../includes/payment-api.php';
    if (!file_exists($paymentHelperPath)) {
        throw new Exception('Helper de pagamentos nao encontrado');
    }
    @include_once $paymentHelperPath;

    $transactionId = isset($_GET['id']) ? trim((string) $_GET['id']) : '';
    if ($transactionId === '') {
        throw new Exception('ID da transacao e obrigatorio');
    }

    $config = cm_payment_get_config();
    cm_payment_validate_config($config);

    $statusUrls = cm_payment_status_url_candidates($config['baseUrl'], $config['statusPathTemplate'], $transactionId);
    $response = null;
    $lastConnectionError = null;

    foreach ($statusUrls as $candidateUrl) {
        $candidateResponse = cm_payment_request(
            'GET',
            $candidateUrl,
            $config['apiKey'],
            $config['userAgent']
        );

        if (!empty($candidateResponse['curlError'])) {
            $lastConnectionError = $candidateResponse['curlError'];
            continue;
        }

        $response = $candidateResponse;
        if ($candidateResponse['httpCode'] >= 200 && $candidateResponse['httpCode'] < 300) {
            break;
        }
    }

    if ($response === null && $lastConnectionError) {
        throw new Exception('Erro ao conectar: ' . $lastConnectionError);
    }

    if (!is_array($response) || $response['httpCode'] < 200 || $response['httpCode'] >= 300) {
        $errorMessage = cm_payment_extract_error_message($response);
        $httpCode = is_array($response) ? (int) $response['httpCode'] : 500;
        http_response_code($httpCode > 0 ? $httpCode : 500);
        echo json_encode([
            'success' => false,
            'error' => $errorMessage,
            'http_code' => $httpCode,
            'response' => is_array($response) ? $response['body'] : null,
        ]);
        exit;
    }

    if (!is_array($response['body'])) {
        throw new Exception('Resposta invalida da API de pagamentos');
    }

    $transfer = cm_payment_extract_transfer($response['body']);
    $status = cm_payment_extract_status(is_array($transfer) ? $transfer : [], $response['body']);

    echo json_encode([
        'success' => true,
        'status' => $status,
        'data' => is_array($transfer) ? $transfer : $response['body'],
        'gateway' => 'ativo_b2b',
    ]);
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
