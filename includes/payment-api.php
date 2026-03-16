<?php

function cm_payment_trimmed_string($value)
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

function cm_payment_is_assoc_array($value)
{
    if (!is_array($value)) {
        return false;
    }

    return array_keys($value) !== range(0, count($value) - 1);
}

function cm_payment_get_config()
{
    $baseUrl = getenv('PAYMENT_API_BASE_URL');
    $apiKey = getenv('PAYMENT_API_KEY');
    $userAgent = getenv('PAYMENT_API_USER_AGENT');
    $createPath = getenv('PAYMENT_API_CREATE_PATH');
    $statusPathTemplate = getenv('PAYMENT_API_STATUS_PATH_TEMPLATE');
    $postbackUrl = getenv('PAYMENT_API_POSTBACK_URL');
    $pixExpiresInDays = getenv('PAYMENT_API_PIX_EXPIRES_IN_DAYS');

    if (defined('PAYMENT_API_BASE_URL') && !$baseUrl) {
        $baseUrl = PAYMENT_API_BASE_URL;
    }
    if (defined('PAYMENT_API_KEY') && !$apiKey) {
        $apiKey = PAYMENT_API_KEY;
    }
    if (defined('PAYMENT_API_USER_AGENT') && !$userAgent) {
        $userAgent = PAYMENT_API_USER_AGENT;
    }
    if (defined('PAYMENT_API_CREATE_PATH') && !$createPath) {
        $createPath = PAYMENT_API_CREATE_PATH;
    }
    if (defined('PAYMENT_API_STATUS_PATH_TEMPLATE') && !$statusPathTemplate) {
        $statusPathTemplate = PAYMENT_API_STATUS_PATH_TEMPLATE;
    }
    if (defined('PAYMENT_API_POSTBACK_URL') && !$postbackUrl) {
        $postbackUrl = PAYMENT_API_POSTBACK_URL;
    }
    if (defined('PAYMENT_API_PIX_EXPIRES_IN_DAYS') && ($pixExpiresInDays === false || $pixExpiresInDays === null || $pixExpiresInDays === '')) {
        $pixExpiresInDays = PAYMENT_API_PIX_EXPIRES_IN_DAYS;
    }

    if (!is_string($userAgent) || trim($userAgent) === '') {
        $userAgent = 'AtivoB2B/1.0';
    }

    if (!is_string($createPath) || trim($createPath) === '') {
        $createPath = '/api/user/transactions';
    }

    if (!is_string($statusPathTemplate) || trim($statusPathTemplate) === '') {
        $statusPathTemplate = '/api/user/transactions/{id}';
    }

    return [
        'baseUrl' => rtrim((string) $baseUrl, '/'),
        'apiKey' => (string) $apiKey,
        'userAgent' => trim((string) $userAgent),
        'createPath' => (string) $createPath,
        'statusPathTemplate' => (string) $statusPathTemplate,
        'postbackUrl' => trim((string) $postbackUrl),
        'pixExpiresInDays' => max(1, (int) $pixExpiresInDays),
    ];
}

function cm_payment_validate_config($config)
{
    if (!is_array($config)) {
        throw new Exception('Configuracao da API de pagamentos invalida');
    }

    if (trim((string) ($config['baseUrl'] ?? '')) === '') {
        throw new Exception('PAYMENT_API_BASE_URL nao configurado');
    }

    if (trim((string) ($config['apiKey'] ?? '')) === '') {
        throw new Exception('PAYMENT_API_KEY nao configurado');
    }
}

function cm_payment_join_url($baseUrl, $path)
{
    $base = rtrim((string) $baseUrl, '/');
    $path = trim((string) $path);
    if ($path === '') {
        return $base;
    }

    if (preg_match('/^https?:\/\//i', $path)) {
        return $path;
    }

    return $base . '/' . ltrim($path, '/');
}

function cm_payment_status_url($baseUrl, $template, $transactionId)
{
    $template = trim((string) $template);
    $encodedId = rawurlencode((string) $transactionId);

    if ($template === '') {
        $template = '/api/user/transactions/{id}';
    }

    if (strpos($template, '{id}') !== false) {
        return cm_payment_join_url($baseUrl, str_replace('{id}', $encodedId, $template));
    }

    $url = cm_payment_join_url($baseUrl, $template);
    $separator = strpos($url, '?') === false ? '?' : '&';
    return $url . $separator . 'id=' . $encodedId;
}

function cm_payment_status_url_candidates($baseUrl, $template, $transactionId)
{
    $candidates = [];
    $defaults = [
        $template,
        '/api/user/transactions/{id}',
        '/api/user/transfers/{id}',
        '/api/user/transactions?id={id}',
        '/api/user/transfers?id={id}',
    ];

    foreach ($defaults as $candidateTemplate) {
        if (!is_string($candidateTemplate) || trim($candidateTemplate) === '') {
            continue;
        }
        $url = cm_payment_status_url($baseUrl, $candidateTemplate, $transactionId);
        if (!in_array($url, $candidates, true)) {
            $candidates[] = $url;
        }
    }

    return $candidates;
}

function cm_payment_request($method, $url, $apiKey, $userAgent, $payload = null)
{
    $method = strtoupper(trim((string) $method));
    $headers = [
        'x-api-key: ' . (string) $apiKey,
        'User-Agent: ' . (string) $userAgent,
        'Accept: application/json',
    ];

    $curlOptions = [
        CURLOPT_URL => (string) $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_SSL_VERIFYPEER => false,
    ];

    if ($payload !== null) {
        $jsonPayload = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($jsonPayload)) {
            throw new Exception('Falha ao serializar payload da API de pagamentos');
        }
        $curlOptions[CURLOPT_POSTFIELDS] = $jsonPayload;
        $curlOptions[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json';
    }

    $ch = curl_init();
    curl_setopt_array($ch, $curlOptions);
    $body = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    $decoded = null;
    if (is_string($body) && trim($body) !== '') {
        $decoded = json_decode($body, true);
    }

    return [
        'httpCode' => $httpCode,
        'curlError' => $curlError,
        'bodyRaw' => $body,
        'body' => is_array($decoded) ? $decoded : null,
    ];
}

function cm_payment_extract_transfer($responseBody)
{
    if (!is_array($responseBody)) {
        return null;
    }

    $candidates = [
        $responseBody['data']['transfer'] ?? null,
        $responseBody['transfer'] ?? null,
        $responseBody['data'] ?? null,
    ];

    foreach ($candidates as $candidate) {
        if (is_array($candidate) && isset($candidate[0]) && is_array($candidate[0])) {
            return $candidate[0];
        }
        if (cm_payment_is_assoc_array($candidate)) {
            return $candidate;
        }
    }

    return null;
}

function cm_payment_extract_pix_code($transfer, $responseBody)
{
    $candidates = [
        $transfer['pixCopiaECola'] ?? null,
        $transfer['brcode'] ?? null,
        $transfer['qrCode'] ?? null,
        $transfer['qr_code'] ?? null,
        $transfer['qrcode'] ?? null,
        $transfer['barcode'] ?? null,
        $transfer['pixKey'] ?? null,
        $transfer['pix']['qrcode'] ?? null,
        $transfer['pix']['qrCode'] ?? null,
        $transfer['pix']['qr_code'] ?? null,
        $responseBody['pixCopiaECola'] ?? null,
        $responseBody['brcode'] ?? null,
        $responseBody['qrCode'] ?? null,
        $responseBody['qr_code'] ?? null,
        $responseBody['qrcode'] ?? null,
        $responseBody['barcode'] ?? null,
        $responseBody['data']['pix']['qrcode'] ?? null,
        $responseBody['data']['pix']['qrCode'] ?? null,
        $responseBody['data']['pix']['qr_code'] ?? null,
        $responseBody['data']['qrCode'] ?? null,
        $responseBody['data']['barcode'] ?? null,
        $responseBody['pixKey'] ?? null,
    ];

    foreach ($candidates as $candidate) {
        $value = cm_payment_trimmed_string($candidate);
        if ($value !== null) {
            return $value;
        }
    }

    return null;
}

function cm_payment_extract_status($transfer, $responseBody)
{
    $status = cm_payment_trimmed_string($transfer['status'] ?? null);
    if ($status !== null) {
        return strtoupper($status);
    }

    $status = cm_payment_trimmed_string($responseBody['status'] ?? null);
    if ($status !== null) {
        return strtoupper($status);
    }

    return 'INPROCESS';
}

function cm_payment_is_paid_status($status)
{
    $status = strtoupper(trim((string) $status));
    if ($status === '') {
        return false;
    }

    $paidStatuses = [
        'PAID',
        'APPROVED',
        'CONFIRMED',
        'SUCCESS',
        'SUCCEEDED',
        'PAYMENT_APPROVED',
        'COMPLETED',
        'SETTLED',
        'DONE',
    ];

    return in_array($status, $paidStatuses, true);
}

function cm_payment_extract_error_message($response)
{
    if (!is_array($response)) {
        return 'Erro desconhecido';
    }

    $body = isset($response['body']) && is_array($response['body']) ? $response['body'] : null;
    if (is_array($body)) {
        $message = cm_payment_trimmed_string($body['message'] ?? null);
        if ($message !== null) {
            return $message;
        }

        $message = cm_payment_trimmed_string($body['error'] ?? null);
        if ($message !== null) {
            return $message;
        }

        if (isset($body['errors']) && is_array($body['errors'])) {
            $flat = [];
            foreach ($body['errors'] as $key => $value) {
                if (is_array($value)) {
                    $flat[] = (string) $key . ': ' . implode(', ', $value);
                } else {
                    $flat[] = (string) $key . ': ' . (string) $value;
                }
            }
            if (!empty($flat)) {
                return implode(' | ', $flat);
            }
        }
    }

    $raw = cm_payment_trimmed_string($response['bodyRaw'] ?? null);
    if ($raw !== null) {
        return $raw;
    }

    return 'Erro desconhecido';
}
