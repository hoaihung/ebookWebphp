<?php
// admin.php
// This file serves the admin interface with access control.
// It ensures that only authenticated administrators can view the admin panel.

// Start the session and include helper functions to check authentication.
session_start();
require_once __DIR__ . '/api/db.php';
require_once __DIR__ . '/api/helpers.php';

// Determine the authenticated user via the helper. If none or not an admin, redirect.
$user = get_authenticated_user();
if (!$user || $user['role'] !== 'admin') {
    // Redirect non‑admin users to login page. Avoid output to maintain headers.
    header('Location: /login.html');
    exit;
}

// If we reach here the user is an admin. Output the admin HTML page.
// We simply read the compiled admin.html and echo it. If needed, dynamic
// injection could be done here (e.g. CSRF tokens). For now, static is fine.
readfile(__DIR__ . '/admin.html');