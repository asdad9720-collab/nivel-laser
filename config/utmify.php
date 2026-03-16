<?php
/**
 * Credenciais da UTMify
 */

if (!defined('UTMIFY_API_TOKEN')) {
    define('UTMIFY_API_TOKEN', getenv('UTMIFY_API_TOKEN') ?: '9XyngLBQE6GdVIPcRkPEZGsJOdUqxWF2mfFI');
}

if (!defined('UTMIFY_PLATFORM_NAME')) {
    define('UTMIFY_PLATFORM_NAME', 'Shopee Clone');
}

if (!defined('UTMIFY_PIXEL_ID')) {
    define('UTMIFY_PIXEL_ID', '69251f2e83c0b0e4729553f9');
}
