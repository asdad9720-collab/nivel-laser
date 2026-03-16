<?php
/**
 * CNPJ API - Consulta MinhaReceita + Fallback Casa dos Dados
 */

// Desabilita exibição de erros no output
error_reporting(0);
ini_set('display_errors', 0);

// Headers
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Token Casa dos Dados (direto no arquivo para evitar problemas de path)
$CASA_DADOS_TOKEN = 'a1e80b277d9f0e7eada94de904bbfebad754168adcbd71550b5fd26ea09aeb5cdeff5112500c387401a1545600af0bd61fdc128e577f34e76ce9995bcbb9709c';

// Obtém CNPJ
$cnpj = isset($_GET['cnpj']) ? $_GET['cnpj'] : '';
$cnpj = preg_replace('/\D/', '', $cnpj);

if (empty($cnpj) || strlen($cnpj) !== 14) {
    echo json_encode(['success' => false, 'error' => 'CNPJ inválido']);
    exit;
}

/**
 * Consulta MinhaReceita (Principal)
 */
function consultarMinhaReceita($cnpj) {
    $apiUrl = "https://minhareceita.org/{$cnpj}";
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $apiUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0'
        ]
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        return null;
    }
    
    $data = json_decode($response, true);
    if (json_last_error() !== JSON_ERROR_NONE || empty($data['razao_social'])) {
        return null;
    }
    
    return [
        'razao_social' => $data['razao_social'],
        'api' => 'MinhaReceita'
    ];
}

/**
 * Consulta Casa dos Dados (Fallback)
 */
function consultarCasaDosDados($cnpj, $token) {
    $apiUrl = "https://api.casadosdados.com.br/v4/cnpj/{$cnpj}";
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $apiUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'api-key: ' . $token
        ]
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        return null;
    }
    
    $data = json_decode($response, true);
    if (json_last_error() !== JSON_ERROR_NONE || empty($data['razao_social'])) {
        return null;
    }
    
    return [
        'razao_social' => $data['razao_social'],
        'api' => 'CasaDosDados'
    ];
}

// Tenta MinhaReceita primeiro
$resultado = consultarMinhaReceita($cnpj);

// Se falhar, tenta Casa dos Dados
if ($resultado === null) {
    $resultado = consultarCasaDosDados($cnpj, $CASA_DADOS_TOKEN);
}

// Se ambas falharem
if ($resultado === null) {
    echo json_encode(['success' => false, 'error' => 'CNPJ não encontrado']);
    exit;
}

// Retorna dados
echo json_encode([
    'success' => true,
    'cnpj' => $cnpj,
    'nomeEmpresarial' => $resultado['razao_social'],
    'dados' => [
        'CNPJ' => $cnpj,
        'Nome' => $resultado['razao_social']
    ],
    'api' => $resultado['api']
]);
