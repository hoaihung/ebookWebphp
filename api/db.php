<?php
/**
 * Database connection helper using PDO.
 * Reads configuration from environment variables:
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE.
 * Returns a singleton PDO instance with UTF8 and error modes enabled.
 */
function get_db() {
    static $db = null;
    if ($db === null) {
        $host = getenv('DB_HOST') ?: 'localhost';
        $port = getenv('DB_PORT') ?: '3306';
        $dbname = getenv('DB_DATABASE') ?: 'ebook2php';
        $user = getenv('DB_USER') ?: 'root';
        $pass = getenv('DB_PASSWORD') ?: '';
        $dsn = "mysql:host={$host};port={$port};dbname={$dbname};charset=utf8mb4";
        try {
            $db = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
        } catch (PDOException $e) {
            http_response_code(500);
            header('Content-Type: application/json');
            echo json_encode(['message' => 'Database connection error', 'detail' => $e->getMessage()]);
            exit;
        }
    }
    return $db;
}