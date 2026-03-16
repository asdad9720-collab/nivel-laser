<?php

function cm_utmify_trimmed_string($value)
{
    if (is_string($value)) {
        $value = trim($value);
        return $value !== '' ? $value : null;
    }

    if (is_numeric($value)) {
        return trim((string) $value);
    }

    return null;
}

function cm_utmify_sanitize_tracking_parameters($source)
{
    $fields = ['src', 'sck', 'utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term'];
    $result = [];

    if (!is_array($source)) {
        return $result;
    }

    foreach ($fields as $field) {
        $value = cm_utmify_trimmed_string($source[$field] ?? null);
        if ($value !== null) {
            $result[$field] = $value;
        }
    }

    return $result;
}

function cm_utmify_to_datetime($value, $fallback = null)
{
    if ($value === null || $value === '') {
        return $fallback;
    }

    if (is_numeric($value)) {
        $timestamp = (int) $value;
        if ($timestamp > 9999999999) {
            $timestamp = (int) floor($timestamp / 1000);
        }
        return gmdate('Y-m-d H:i:s', $timestamp);
    }

    try {
        $date = new DateTime((string) $value);
        return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    } catch (Exception $error) {
        return $fallback;
    }
}

function cm_utmify_map_status($status)
{
    $normalized = strtolower(trim((string) $status));

    if ($normalized === 'pending' || $normalized === 'waiting_payment' || $normalized === 'created') {
        return 'waiting_payment';
    }

    if ($normalized === 'paid' || $normalized === 'approved' || $normalized === 'completed' || $normalized === 'confirmed' || $normalized === 'success' || $normalized === 'settled') {
        return 'paid';
    }

    if ($normalized === 'refunded') {
        return 'refunded';
    }

    if ($normalized === 'chargedback' || $normalized === 'chargeback') {
        return 'chargedback';
    }

    return 'refused';
}

function cm_utmify_store_path()
{
    return __DIR__ . '/../config/utmify-orders.json';
}

function cm_utmify_read_store()
{
    $path = cm_utmify_store_path();
    if (!file_exists($path)) {
        return [];
    }

    $raw = @file_get_contents($path);
    if (!is_string($raw) || $raw === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function cm_utmify_write_store($store)
{
    $path = cm_utmify_store_path();
    $directory = dirname($path);

    if (!is_dir($directory)) {
        @mkdir($directory, 0777, true);
    }

    @file_put_contents($path, json_encode($store, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), LOCK_EX);
}

function cm_utmify_load_context($orderId)
{
    $key = trim((string) $orderId);
    if ($key === '') {
        return null;
    }

    $store = cm_utmify_read_store();
    return isset($store[$key]) && is_array($store[$key]) ? $store[$key] : null;
}

function cm_utmify_save_context($context)
{
    if (!is_array($context)) {
        return null;
    }

    $orderId = cm_utmify_trimmed_string($context['orderId'] ?? null);
    if ($orderId === null) {
        return null;
    }

    $store = cm_utmify_read_store();
    $existing = isset($store[$orderId]) && is_array($store[$orderId]) ? $store[$orderId] : [];
    $syncedStatuses = isset($existing['syncedStatuses']) && is_array($existing['syncedStatuses']) ? $existing['syncedStatuses'] : [];

    $merged = array_merge($existing, $context);
    $merged['orderId'] = $orderId;
    $merged['trackingParameters'] = cm_utmify_sanitize_tracking_parameters($merged['trackingParameters'] ?? []);
    $merged['syncedStatuses'] = $syncedStatuses;
    $merged['updatedAt'] = time();

    if (!isset($merged['createdAt'])) {
        $merged['createdAt'] = round(microtime(true) * 1000);
    }

    $store[$orderId] = $merged;
    cm_utmify_write_store($store);

    return $merged;
}

function cm_utmify_mark_status_synced($orderId, $status)
{
    $orderId = trim((string) $orderId);
    $status = strtolower(trim((string) $status));
    if ($orderId === '' || $status === '') {
        return;
    }

    $store = cm_utmify_read_store();
    if (!isset($store[$orderId]) || !is_array($store[$orderId])) {
        return;
    }

    if (!isset($store[$orderId]['syncedStatuses']) || !is_array($store[$orderId]['syncedStatuses'])) {
        $store[$orderId]['syncedStatuses'] = [];
    }

    $store[$orderId]['syncedStatuses'][$status] = time();
    $store[$orderId]['updatedAt'] = time();
    cm_utmify_write_store($store);
}

function cm_utmify_has_status_synced($orderId, $status)
{
    $context = cm_utmify_load_context($orderId);
    $status = strtolower(trim((string) $status));

    if (!is_array($context) || $status === '') {
        return false;
    }

    return !empty($context['syncedStatuses'][$status]);
}

function cm_utmify_build_payload($context, $forcedStatus = null)
{
    if (!is_array($context)) {
        throw new Exception('Contexto UTMify invalido');
    }

    $orderId = cm_utmify_trimmed_string($context['orderId'] ?? null);
    if ($orderId === null) {
        throw new Exception('orderId e obrigatorio');
    }

    $status = cm_utmify_map_status($forcedStatus !== null ? $forcedStatus : ($context['status'] ?? 'pending'));
    $paymentMethod = strtolower((string) ($context['paymentMethod'] ?? 'pix'));
    $amountCents = (int) ($context['amountCents'] ?? 0);

    if ($amountCents <= 0) {
        throw new Exception('amountCents invalido');
    }

    $customer = isset($context['customer']) && is_array($context['customer']) ? $context['customer'] : [];
    $product = isset($context['product']) && is_array($context['product']) ? $context['product'] : [];
    $tracking = cm_utmify_sanitize_tracking_parameters($context['trackingParameters'] ?? []);

    $customerName = cm_utmify_trimmed_string($customer['name'] ?? null);
    $customerEmail = cm_utmify_trimmed_string($customer['email'] ?? null);
    $customerPhone = cm_utmify_trimmed_string($customer['phone'] ?? null);
    $customerDocument = preg_replace('/\D/', '', (string) ($customer['document'] ?? ''));
    $productName = cm_utmify_trimmed_string($product['name'] ?? null);
    $productId = cm_utmify_trimmed_string($product['id'] ?? null);
    $quantity = max(1, (int) ($product['quantity'] ?? 1));

    if ($customerName === null) {
        throw new Exception('customer.name e obrigatorio');
    }

    if ($productName === null) {
        throw new Exception('product.name e obrigatorio');
    }

    if ($customerEmail === null) {
        $customerEmail = 'contato@example.com';
    }

    if ($customerDocument === '') {
        $customerDocument = '00000000000';
    }

    $createdAt = cm_utmify_to_datetime($context['createdAt'] ?? null, gmdate('Y-m-d H:i:s'));
    $approvedDate = $status === 'paid'
        ? cm_utmify_to_datetime($context['approvedDate'] ?? null, gmdate('Y-m-d H:i:s'))
        : cm_utmify_to_datetime($context['approvedDate'] ?? null, null);

    return [
        'orderId' => $orderId,
        'platform' => defined('UTMIFY_PLATFORM_NAME') ? UTMIFY_PLATFORM_NAME : 'Shopee Clone',
        'paymentMethod' => $paymentMethod ?: 'pix',
        'status' => $status,
        'createdAt' => $createdAt,
        'approvedDate' => $approvedDate,
        'refundedAt' => null,
        'customer' => [
            'name' => $customerName,
            'email' => $customerEmail,
            'phone' => $customerPhone,
            'document' => $customerDocument,
            'country' => 'BR',
        ],
        'products' => [[
            'id' => $productId ?: $orderId,
            'name' => $productName,
            'planId' => null,
            'planName' => null,
            'quantity' => $quantity,
            'priceInCents' => $amountCents,
        ]],
        'trackingParameters' => [
            'src' => $tracking['src'] ?? null,
            'sck' => $tracking['sck'] ?? null,
            'utm_source' => $tracking['utm_source'] ?? null,
            'utm_campaign' => $tracking['utm_campaign'] ?? null,
            'utm_medium' => $tracking['utm_medium'] ?? null,
            'utm_content' => $tracking['utm_content'] ?? null,
            'utm_term' => $tracking['utm_term'] ?? null,
        ],
        'commission' => [
            'totalPriceInCents' => $amountCents,
            'gatewayFeeInCents' => 0,
            'userCommissionInCents' => $amountCents,
        ],
        'isTest' => false,
    ];
}

function cm_utmify_send_payload($payload)
{
    $apiToken = defined('UTMIFY_API_TOKEN') ? UTMIFY_API_TOKEN : (getenv('UTMIFY_API_TOKEN') ?: '');
    if (!$apiToken) {
        throw new Exception('UTMIFY_API_TOKEN nao configurado');
    }

    $jsonPayload = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($jsonPayload) || $jsonPayload === '') {
        throw new Exception('Falha ao serializar payload da UTMify');
    }

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => 'https://api.utmify.com.br/api-credentials/orders',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $jsonPayload,
        CURLOPT_HTTPHEADER => [
            'x-api-token: ' . $apiToken,
            'Content-Type: application/json',
            'Accept: application/json',
            'Content-Length: ' . strlen($jsonPayload)
        ],
        CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true
    ]);

    $responseBody = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        throw new Exception('Erro de conexao com a UTMify: ' . $curlError);
    }

    $decodedResponse = json_decode((string) $responseBody, true);

    if ($httpCode < 200 || $httpCode >= 300) {
        $errorMessage = null;
        if (is_array($decodedResponse)) {
            $errorMessage = $decodedResponse['message'] ?? $decodedResponse['error'] ?? null;
        }
        if (!$errorMessage) {
            $errorMessage = trim((string) $responseBody) ?: ('HTTP ' . $httpCode);
        }
        throw new Exception('Utmify API error: ' . $errorMessage);
    }

    return [
        'httpCode' => $httpCode,
        'body' => $decodedResponse ?: $responseBody
    ];
}

function cm_sync_utmify_order($context, $forcedStatus = null)
{
    $savedContext = cm_utmify_save_context($context);
    if (!is_array($savedContext)) {
        throw new Exception('Nao foi possivel salvar o contexto da UTMify');
    }

    $payload = cm_utmify_build_payload($savedContext, $forcedStatus);
    $normalizedStatus = strtolower(trim((string) ($forcedStatus !== null ? $forcedStatus : ($savedContext['status'] ?? 'pending'))));
    $response = cm_utmify_send_payload($payload);

    cm_utmify_mark_status_synced($savedContext['orderId'], $normalizedStatus);

    return [
        'success' => true,
        'orderId' => $savedContext['orderId'],
        'status' => $normalizedStatus,
        'payload' => $payload,
        'response' => $response
    ];
}

function cm_sync_utmify_order_from_store($orderId, $forcedStatus = null)
{
    $context = cm_utmify_load_context($orderId);
    if (!is_array($context)) {
        throw new Exception('Contexto do pedido nao encontrado para a UTMify');
    }

    return cm_sync_utmify_order($context, $forcedStatus);
}
