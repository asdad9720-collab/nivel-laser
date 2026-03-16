<?php
/**
 * Credenciais da API de pagamentos
 *
 * Defina estas variaveis no servidor:
 * - PAYMENT_API_BASE_URL
 * - PAYMENT_API_KEY
 * O restante possui default seguro para o fluxo atual.
 */

if (!defined('PAYMENT_API_BASE_URL')) {
    define('PAYMENT_API_BASE_URL', getenv('PAYMENT_API_BASE_URL') ?: 'https://api-gateway.techbynet.com');
}

if (!defined('PAYMENT_API_KEY')) {
    define('PAYMENT_API_KEY', getenv('PAYMENT_API_KEY') ?: '4ccb061f-b0dd-4932-8852-3b5e62286213');
}

if (!defined('PAYMENT_API_USER_AGENT')) {
    define('PAYMENT_API_USER_AGENT', getenv('PAYMENT_API_USER_AGENT') ?: 'AtivoB2B/1.0');
}

if (!defined('PAYMENT_API_CREATE_PATH')) {
    define('PAYMENT_API_CREATE_PATH', getenv('PAYMENT_API_CREATE_PATH') ?: '/api/user/transactions');
}

if (!defined('PAYMENT_API_STATUS_PATH_TEMPLATE')) {
    define('PAYMENT_API_STATUS_PATH_TEMPLATE', getenv('PAYMENT_API_STATUS_PATH_TEMPLATE') ?: '/api/user/transactions/{id}');
}

if (!defined('PAYMENT_API_POSTBACK_URL')) {
    define('PAYMENT_API_POSTBACK_URL', getenv('PAYMENT_API_POSTBACK_URL') ?: '');
}

if (!defined('PAYMENT_API_PIX_EXPIRES_IN_DAYS')) {
    define('PAYMENT_API_PIX_EXPIRES_IN_DAYS', (int) (getenv('PAYMENT_API_PIX_EXPIRES_IN_DAYS') ?: 1));
}
