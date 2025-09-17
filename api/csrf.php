<?php
// api/csrf.php
function ensure_session_started() {
    if (session_status() !== PHP_SESSION_ACTIVE) session_start();
}
function csrf_token() {
    ensure_session_started();
    // Generate a CSRF token if one does not already exist.  We use a single
    // unified session key ("csrf") to avoid multiple independent tokens being
    // created for the same session.  The token is also mirrored into
    // $_SESSION['csrf_token'] so that any legacy code or helpers referring
    // to that name will receive the same value.  This prevents mismatched
    // tokens when different parts of the system read from different keys.
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    // Ensure both keys point to the same token
    $_SESSION['csrf_token'] = $_SESSION['csrf'];
    return $_SESSION['csrf'];
}
function send_csrf_cookie() {
    $token = csrf_token();
    // Cho phép JS đọc để đặt header (HttpOnly=false), SameSite=Lax là đủ cho SPA cùng domain
    setcookie('XSRF-TOKEN', $token, [
        'path' => '/',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly' => false,
        'samesite' => 'Lax',
    ]);
    header('X-CSRF-Token: ' . $token); // optional: cho frontend lấy nhanh
}
function verify_csrf_or_fail() {
    ensure_session_started();
    $needCheck = in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['POST','PUT','PATCH','DELETE'], true);
    if (!$needCheck) return;
    $hdr = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!$hdr || !hash_equals($_SESSION['csrf'] ?? '', $hdr)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['message' => 'Forbidden (CSRF)']);
        exit;
    }
}
