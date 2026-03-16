<?php
/**
 * PIX API - Consulta de status na nova API de pagamentos
 */

error_reporting(0);
ini_set('display_errors', 0);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

try {
    $configPath = __DIR__ . '/../config/pix-credentials.php';
    if (file_exists($configPath)) {
        @include_once $configPath;
    }

    $utmifyConfigPath = __DIR__ . '/../config/utmify.php';
    if (file_exists($utmifyConfigPath)) {
        @include_once $utmifyConfigPath;
    }

    $paymentHelperPath = __DIR__ . '/../includes/payment-api.php';
    if (!file_exists($paymentHelperPath)) {
        throw new Exception('Helper de pagamentos nao encontrado');
    }
    @include_once $paymentHelperPath;

    $gatewayHelperPath = __DIR__ . '/../includes/gateway-state.php';
    if (file_exists($gatewayHelperPath)) {
        @include_once $gatewayHelperPath;
    }

    $utmifyHelperPath = __DIR__ . '/../includes/utmify-sync.php';
    if (file_exists($utmifyHelperPath)) {
        @include_once $utmifyHelperPath;
    }

    $transactionId = isset($_GET['id']) ? trim((string) $_GET['id']) : '';
    if ($transactionId === '') {
        throw new Exception('ID da transacao e obrigatorio');
    }

    $gateway = 'ativo_b2b';
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
        echo json_encode([
            'success' => true,
            'status' => 'INPROCESS',
            'paid' => false,
            'message' => 'Aguardando confirmacao',
            'gateway' => $gateway,
        ]);
        exit;
    }

    if (!is_array($response['body'])) {
        throw new Exception('Resposta invalida da API de pagamentos');
    }

    $transfer = cm_payment_extract_transfer($response['body']);
    $status = cm_payment_extract_status(is_array($transfer) ? $transfer : [], $response['body']);
    $paid = cm_payment_is_paid_status($status);

    if (!$paid && is_array($transfer)) {
        $paidAt = cm_payment_trimmed_string($transfer['paidAt'] ?? null);
        if ($paidAt !== null) {
            $paid = true;
        }
    }

    if ($paid && function_exists('mark_transaction_paid_and_toggle')) {
        mark_transaction_paid_and_toggle($transactionId, $gateway);
    }

    $utmifyPaidSynced = false;
    $utmifyPaidError = null;

    if ($paid && function_exists('cm_sync_utmify_order_from_store') && !cm_utmify_has_status_synced($transactionId, 'paid')) {
        try {
            cm_sync_utmify_order_from_store($transactionId, 'paid');
            $utmifyPaidSynced = true;
        } catch (Exception $utmifyError) {
            $utmifyPaidError = $utmifyError->getMessage();
        }
    }

    echo json_encode([
        'success' => true,
        'status' => $status,
        'paid' => $paid,
        'data' => [
            'transfer' => $transfer,
            'response' => $response['body'],
        ],
        'gateway' => $gateway,
        'utmifyPaidSynced' => $utmifyPaidSynced,
        'utmifyPaidError' => $utmifyPaidError,
    ]);
} catch (Exception $e) {
    echo json_encode([
        'success' => true,
        'status' => 'INPROCESS',
        'paid' => false,
        'error' => $e->getMessage(),
    ]);
}
