<?php
/**
 * PIX API - Criacao de cobranca na nova API de pagamentos
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
    echo json_encode(['error' => 'Metodo nao permitido']);
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

    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    if (!is_array($data)) {
        throw new Exception('JSON invalido');
    }

    $amount = isset($data['amount']) ? (int) $data['amount'] : 0;
    $cnpj = isset($data['cnpj']) ? (string) $data['cnpj'] : '';
    $nome = isset($data['nome']) ? (string) $data['nome'] : 'Cliente';
    $periodos = isset($data['periodos']) && is_array($data['periodos']) ? $data['periodos'] : [];
    $metadataExtra = (isset($data['metadata']) && is_array($data['metadata'])) ? $data['metadata'] : [];
    $trackingParameters = (isset($data['trackingParameters']) && is_array($data['trackingParameters'])) ? $data['trackingParameters'] : [];
    $customerPhone = isset($data['customerPhone']) ? (string) $data['customerPhone'] : '';
    $customerEmailInput = isset($data['customerEmail']) ? (string) $data['customerEmail'] : '';
    $customerAddress = (isset($data['customerAddress']) && is_array($data['customerAddress'])) ? $data['customerAddress'] : [];
    $productIdInput = isset($data['productId']) ? (string) $data['productId'] : '';
    $checkoutCreatedAt = isset($data['createdAt']) ? $data['createdAt'] : null;

    $cnpjLimpo = preg_replace('/\D/', '', $cnpj);

    if ($amount < 100) {
        throw new Exception('Valor minimo: R$ 1,00');
    }

    if (strlen($cnpjLimpo) !== 14 && strlen($cnpjLimpo) !== 11) {
        throw new Exception('CNPJ/CPF invalido');
    }

    $nomeCliente = trim($nome) !== '' && trim($nome) !== '-' ? trim($nome) : 'Cliente';
    $transactionIdLocal = (string) (time() . rand(1000, 9999));
    $gateway = 'ativo_b2b';

    $config = cm_payment_get_config();
    cm_payment_validate_config($config);

    $docType = strlen($cnpjLimpo) === 14 ? 'CNPJ' : 'CPF';
    $phoneDigits = preg_replace('/\D/', '', $customerPhone);
    if ($phoneDigits === '') {
        $phoneDigits = '11999999999';
    }

    $emailCliente = trim($customerEmailInput);
    if ($emailCliente === '' || strpos($emailCliente, '@') === false) {
        $baseEmail = strtolower($nomeCliente);
        $baseEmail = iconv('UTF-8', 'ASCII//TRANSLIT', $baseEmail);
        $baseEmail = preg_replace('/[^a-z0-9]/', '', (string) $baseEmail);
        $baseEmail = substr((string) $baseEmail, 0, 24);
        if ($baseEmail === '') {
            $baseEmail = 'cliente';
        }
        $emailCliente = $baseEmail . '@gmail.com';
    }

    $street = trim((string) ($customerAddress['street'] ?? ''));
    $streetNumber = trim((string) ($customerAddress['streetNumber'] ?? ''));
    $complement = trim((string) ($customerAddress['complement'] ?? ''));
    $zipCode = preg_replace('/\D/', '', (string) ($customerAddress['zipCode'] ?? ''));
    $neighborhood = trim((string) ($customerAddress['neighborhood'] ?? ''));
    $city = trim((string) ($customerAddress['city'] ?? ''));
    $state = trim((string) ($customerAddress['state'] ?? ''));
    $country = strtolower(trim((string) ($customerAddress['country'] ?? 'br')));

    $productTitle = isset($metadataExtra['product_title'])
        ? (string) $metadataExtra['product_title']
        : (isset($periodos[0]) ? (string) $periodos[0] : 'Produto');
    if (trim($productTitle) === '') {
        $productTitle = 'Produto';
    }

    $metadata = array_merge([
        'order_id' => (string) $transactionIdLocal,
        'periodos' => $periodos,
        'document' => $cnpjLimpo
    ], $metadataExtra);

    $requestPayload = [
        'amount' => (int) $amount,
        'paymentMethod' => 'PIX',
        'customer' => [
            'name' => $nomeCliente,
            'email' => $emailCliente,
            'document' => [
                'number' => $cnpjLimpo,
                'type' => $docType,
            ],
            'phone' => $phoneDigits,
            'externalRef' => (string) $transactionIdLocal,
            'address' => [
                'street' => $street,
                'streetNumber' => $streetNumber,
                'complement' => $complement,
                'zipCode' => $zipCode,
                'neighborhood' => $neighborhood,
                'city' => $city,
                'state' => strtoupper($state),
                'country' => $country !== '' ? $country : 'br',
            ],
        ],
        'items' => [
            [
                'title' => $productTitle,
                'unitPrice' => (int) $amount,
                'quantity' => 1,
                'tangible' => true,
                'externalRef' => 'item-' . $transactionIdLocal,
            ]
        ],
        'pix' => [
            'expiresInDays' => (int) ($config['pixExpiresInDays'] ?? 1),
        ],
        'metadata' => json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ];

    if (!empty($config['postbackUrl'])) {
        $requestPayload['postbackUrl'] = (string) $config['postbackUrl'];
    }

    $createUrl = cm_payment_join_url($config['baseUrl'], $config['createPath']);
    $response = cm_payment_request(
        'POST',
        $createUrl,
        $config['apiKey'],
        $config['userAgent'],
        $requestPayload
    );

    if (!empty($response['curlError'])) {
        throw new Exception('Erro de conexao: ' . $response['curlError']);
    }

    if ($response['httpCode'] < 200 || $response['httpCode'] >= 300) {
        $errorMessage = cm_payment_extract_error_message($response);
        throw new Exception('Erro API (' . (int) $response['httpCode'] . '): ' . $errorMessage);
    }

    if (!is_array($response['body'])) {
        throw new Exception('Resposta invalida da API de pagamentos');
    }

    $transfer = cm_payment_extract_transfer($response['body']);
    if (!is_array($transfer)) {
        throw new Exception('Transferencia nao encontrada na resposta da API');
    }

    $transactionIdResp = cm_payment_trimmed_string($transfer['id'] ?? null);
    if ($transactionIdResp === null) {
        $transactionIdResp = cm_payment_trimmed_string($response['body']['id'] ?? null);
    }
    if ($transactionIdResp === null) {
        $transactionIdResp = $transactionIdLocal;
    }

    $statusResp = cm_payment_extract_status($transfer, $response['body']);
    $pixCode = cm_payment_extract_pix_code($transfer, $response['body']);
    if ($pixCode === null) {
        throw new Exception('Codigo PIX nao encontrado na resposta');
    }

    $expiresAt = cm_payment_trimmed_string(
        $transfer['pix']['expirationDate'] ??
        $transfer['expiresAt'] ??
        $transfer['expirationDate'] ??
        $response['body']['data']['pix']['expirationDate'] ??
        $response['body']['expiresAt'] ??
        null
    );

    if (function_exists('record_transaction_gateway')) {
        record_transaction_gateway($transactionIdResp, $gateway);
    }

    $utmifyPendingSynced = false;
    $utmifyPendingError = null;

    if (function_exists('cm_sync_utmify_order')) {
        $utmifyContext = [
            'orderId' => (string) $transactionIdResp,
            'status' => 'pending',
            'paymentMethod' => 'pix',
            'amountCents' => (int) $amount,
            'createdAt' => $checkoutCreatedAt ?: round(microtime(true) * 1000),
            'customer' => [
                'name' => $nomeCliente,
                'phone' => $customerPhone,
                'document' => $cnpjLimpo,
                'email' => $emailCliente,
            ],
            'product' => [
                'id' => $productIdInput !== '' ? $productIdInput : (string) $transactionIdResp,
                'name' => $productTitle,
                'quantity' => isset($metadataExtra['quantity']) ? (int) $metadataExtra['quantity'] : 1,
            ],
            'trackingParameters' => $trackingParameters,
        ];

        try {
            cm_sync_utmify_order($utmifyContext, 'pending');
            $utmifyPendingSynced = true;
        } catch (Exception $utmifyError) {
            $utmifyPendingError = $utmifyError->getMessage();
            if (function_exists('cm_utmify_save_context')) {
                cm_utmify_save_context($utmifyContext);
            }
        }
    }

    echo json_encode([
        'success' => true,
        'brcode' => $pixCode,
        'pixCopiaECola' => $pixCode,
        'transactionId' => (string) $transactionIdResp,
        'id' => (string) $transactionIdResp,
        'status' => $statusResp,
        'expiresAt' => $expiresAt,
        'gateway' => $gateway,
        'utmifyPendingSynced' => $utmifyPendingSynced,
        'utmifyPendingError' => $utmifyPendingError,
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
