<?php
// Main API router for the PHP version of EbookWeb.
// All API requests under /api are routed through this file. It handles
// authentication, user management and book retrieval similarly to the
// Node.js implementation. Responses are JSON.

// Set the CORS origin dynamically to allow session cookies. When allowing
// credentials, '*' is not permitted, so use the requesting origin if provided.
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '*';
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
// Allow credentials so that session cookies can be sent with requests
header('Access-Control-Allow-Credentials: true');
// Additional security headers to mitigate clickjacking and MIME sniffing
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer-when-downgrade');

// Respond to preflight CORS requests immediately
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/helpers.php';

// Initialise session early so that CSRF tokens and user data can be stored.
// Only start a session if not already started to avoid warnings.
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

/**
 * Generate and return a CSRF token for the current admin session. If no token
 * exists, a new one is created and stored in the session. The token is a
 * 64-character hex string generated from 32 random bytes. This endpoint
 * should only be accessed by authenticated administrators and is intended
 * to be called by the admin frontend on load to obtain the token.
 *
 * Route: GET /admin/csrf
 */
function get_csrf_token() {
    if (!isset($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/**
 * Verify the CSRF token included in the request headers. For all
 * state-changing requests (POST, PUT, DELETE) to admin endpoints,
 * the X-CSRF-Token header must match the token stored in the session.
 * If the token is missing or mismatched, a 403 response is sent.
 */
function verify_csrf_token() {
    // Only validate for non-GET/OPTIONS requests
    $method = $_SERVER['REQUEST_METHOD'];
    if ($method === 'GET' || $method === 'OPTIONS') {
        return;
    }
    // Fetch the token from headers (case-insensitive). See helpers for getallheaders fallback
    $tokenHeader = '';
    if (isset($_SERVER['HTTP_X_CSRF_TOKEN'])) {
        $tokenHeader = $_SERVER['HTTP_X_CSRF_TOKEN'];
    } elseif (function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $key => $val) {
            if (strcasecmp($key, 'X-CSRF-Token') === 0) {
                $tokenHeader = $val;
                break;
            }
        }
    }
    $expected = isset($_SESSION['csrf_token']) ? $_SESSION['csrf_token'] : null;
    if (!$expected || !$tokenHeader || !hash_equals($expected, $tokenHeader)) {
        send_json(['message' => 'CSRF token không hợp lệ hoặc thiếu.'], 403);
    }
}

// Helper to find a unique chapter number for a book. If the desired number is
// already taken for the given book, it increments until a free slot is found.
// Returns an array [finalNumber, warnings] where warnings is an array of
// strings describing any adjustments made.
function find_unique_chapter_number(PDO $db, int $bookId, ?int $desired): array {
    $warnings = [];
    // If no desired number provided or invalid, default to 1
    $num = ($desired && $desired > 0) ? $desired : 1;
    // Check for existence and increment until unique
    while (true) {
        $stmt = $db->prepare('SELECT id FROM chapters WHERE book_id = ? AND chapter_number = ?');
        $stmt->execute([$bookId, $num]);
        $existing = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$existing) {
            // Found free slot
            break;
        }
        // If the number is already taken, increment and record a warning
        $warnings[] = "chapter_number $num đã tồn tại, chương được gán thành " . ($num + 1);
        $num++;
    }
    return [$num, $warnings];
}
// We will reuse logic from the CLI importer. Define a function to import
// or update a book from a folder containing toc.json and chapter JSON files.
/**
 * Import or update a book from a folder on the server. The folder must contain
 * a `toc.json` file and sub-files for each chapter. The function will read
 * the TOC and chapters, store the TOC in books.toc_json and insert chapter
 * records into the chapters table. If $bookId is null a new book is created.
 *
 * @param PDO $db
 * @param string $folder Relative path from project root to the folder (e.g. 'sample-book/InsightToMoney')
 * @param int|null $bookId The ID of the existing book to update, or null to create a new one
 * @param string $accessLevel Either 'free' or 'paid'
 * @param bool $isPublished Whether the book should be marked as published
 * @return int The ID of the imported/updated book
 * @throws Exception if parsing fails or folder not found
 */
function import_book_from_folder(PDO $db, $folder, $bookId = null, $accessLevel = 'free', $isPublished = false) {
    $projectRoot = realpath(__DIR__ . '/..');
    // Normalize folder path relative to project root
    $folderPath = realpath($projectRoot . '/' . ltrim($folder, '/'));
    if (!$folderPath || !is_dir($folderPath)) {
        throw new Exception('Thư mục sách không tồn tại: ' . $folder);
    }
    $tocFile = $folderPath . '/toc.json';
    if (!file_exists($tocFile)) {
        throw new Exception('Không tìm thấy toc.json trong thư mục: ' . $folder);
    }
    $tocContent = file_get_contents($tocFile);
    $toc = json_decode($tocContent, true);
    if (!$toc) {
        throw new Exception('Không thể parse toc.json');
    }
    // Determine book title from toc or folder name
    $title = isset($toc['ebookTitle']) ? $toc['ebookTitle'] : basename($folderPath);
    // Default template path. Use the renamed default template instead of the old UXMastery one.
    $templatePath = '/assets/templates/default-ebook-template.html';
    // Determine cover image. Prioritise specified 'cover' in toc.json or images in the import folder.
    $cover = null;
    // Try to read cover from toc if defined
    if (isset($toc['cover']) && $toc['cover']) {
        $candidate = $folderPath . '/' . $toc['cover'];
        if (is_file($candidate)) {
            $cover = $candidate;
        }
    }
    // Scan the import folder for common cover file names if not yet found
    if (!$cover) {
        $patterns = ['cover', 'front', 'thumbnail'];
        $exts = ['jpg','jpeg','png','webp'];
        foreach ($patterns as $p) {
            foreach ($exts as $ext) {
                $candidate = $folderPath . '/' . $p . '.' . $ext;
                if (is_file($candidate)) {
                    $cover = $candidate;
                    break 2;
                }
            }
        }
    }
    // Fall back to first image in folder
    if (!$cover) {
        foreach (['jpg','jpeg','png','webp'] as $ext) {
            $files = glob($folderPath . '/*.' . $ext);
            if ($files) { $cover = $files[0]; break; }
        }
    }
    // If cover is still a file path (found in folder), copy it into uploads/covers and set public URL
    if ($cover && is_file($cover) && strpos($cover, $folderPath) === 0) {
        $baseUpload = realpath(__DIR__ . '/..') . '/uploads/covers';
        if (!is_dir($baseUpload)) {
            mkdir($baseUpload, 0775, true);
        }
        $ext = strtolower(pathinfo($cover, PATHINFO_EXTENSION));
        $unique = 'import_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
        $dest = $baseUpload . '/' . $unique;
        @copy($cover, $dest);
        $cover = '/uploads/covers/' . $unique;
    } else {
        // If still not found or not from import folder, match assets/images/book by folder name
        $cover = null;
        $imagesDir = $projectRoot . '/assets/images/book';
        if (is_dir($imagesDir)) {
            $baseName = strtolower(basename($folderPath));
            foreach (scandir($imagesDir) as $file) {
                if (preg_match('/^' . preg_quote($baseName, '/') . '\\./i', $file)) {
                    $cover = '/assets/images/book/' . $file;
                    break;
                }
            }
        }
    }
    // Compute relative path to original toc for reference
    $tocRelative = trim(str_replace($projectRoot . '/sample-book/', '', $tocFile), '/');
    // Encode toc as JSON string
    $tocJson = json_encode($toc);
    // Perform DB operations
    $db->beginTransaction();
    try {
        if ($bookId) {
            // Update existing book
            $stmt = $db->prepare('UPDATE books SET title=?, toc_path=?, template_path=?, access_level=?, is_published=?, toc_json=?, cover_image_url=IFNULL(?, cover_image_url) WHERE id=?');
            $stmt->execute([$title, $tocRelative, $templatePath, $accessLevel, $isPublished ? 1 : 0, $tocJson, $cover, $bookId]);
            $newBookId = $bookId;
        } else {
            $stmt = $db->prepare('INSERT INTO books (title, toc_path, template_path, access_level, is_published, toc_json, cover_image_url) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$title, $tocRelative, $templatePath, $accessLevel, $isPublished ? 1 : 0, $tocJson, $cover]);
            $newBookId = (int)$db->lastInsertId();
        }
        // Remove existing chapters
        $stmt = $db->prepare('DELETE FROM chapters WHERE book_id = ?');
        $stmt->execute([$newBookId]);
        // Insert chapters
        foreach ($toc['phases'] as $phase) {
            foreach ($phase['chapters'] as $chapter) {
                $chapterNumber = (int)$chapter['chapterNumber'];
                $chapterTitle = $chapter['chapterTitle'];
                $type = isset($chapter['type']) ? $chapter['type'] : null;
                $week = isset($chapter['week']) ? (int)$chapter['week'] : null;
                $chapterFile = $folderPath . '/' . $chapter['jsonFile'];
                if (!file_exists($chapterFile)) {
                    // Skip missing chapter files but continue with others
                    continue;
                }
                $chapterData = file_get_contents($chapterFile);
                $chapterJson = json_decode($chapterData, true);
                if (!$chapterJson) {
                    continue;
                }
                $stmt = $db->prepare('INSERT INTO chapters (book_id, chapter_number, title, type, week, content) VALUES (?, ?, ?, ?, ?, ?)');
                $stmt->execute([$newBookId, $chapterNumber, $chapterTitle, $type, $week, json_encode($chapterJson)]);
            }
        }
        $db->commit();
    } catch (Exception $e) {
        $db->rollBack();
        throw $e;
    }
    return $newBookId;
}

/**
 * Create a notification row. If $userId is null, the notification is broadcast to all users.
 *
 * @param PDO $db
 * @param string $title
 * @param string $message
 * @param string|null $linkUrl
 * @param int|null $userId
 * @return int The ID of the inserted notification
 */
function add_notification(PDO $db, $title, $message, $linkUrl = null, $userId = null) {
    $stmt = $db->prepare('INSERT INTO notifications (user_id, title, message, link_url, is_read) VALUES (?, ?, ?, ?, 0)');
    $stmt->execute([$userId, $title, $message, $linkUrl]);
    return (int)$db->lastInsertId();
}

/**
 * Mark a notification as read for a given user. If the notification has a
 * specific user_id (targeted), it simply updates the is_read flag. If the
 * notification is broadcast (user_id is NULL), it records the read status in
 * user_notifications so that other users still see the notification.
 *
 * @param PDO $db
 * @param int $notificationId
 * @param int $userId
 */
function mark_notification_read(PDO $db, $notificationId, $userId) {
    // Fetch the notification to determine if broadcast
    $stmt = $db->prepare('SELECT user_id FROM notifications WHERE id = ?');
    $stmt->execute([$notificationId]);
    $notif = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$notif) {
        return;
    }
    if ($notif['user_id'] !== null) {
        // Targeted notification: simply mark is_read
        $stmt = $db->prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?');
        $stmt->execute([$notificationId, $userId]);
    } else {
        // Broadcast: insert into user_notifications if not exists
        $stmt = $db->prepare('INSERT IGNORE INTO user_notifications (user_id, notification_id) VALUES (?, ?)');
        $stmt->execute([$userId, $notificationId]);
    }
}

/**
 * Retrieve notifications for a user. Returns both targeted notifications and
 * broadcast notifications. Each notification includes a `read` boolean.
 * Broadcast notifications are considered read if an entry exists in
 * user_notifications for the user.
 *
 * @param PDO $db
 * @param int $userId
 * @return array
 */
function get_notifications_for_user(PDO $db, $userId) {
    // Targeted notifications for this user
    $stmt = $db->prepare('SELECT id, title, message, link_url, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC');
    $stmt->execute([$userId]);
    $targeted = $stmt->fetchAll(PDO::FETCH_ASSOC);
    // Broadcast notifications
    $stmt = $db->prepare('SELECT n.id, n.title, n.message, n.link_url, n.created_at, (
        CASE WHEN un.notification_id IS NOT NULL THEN 1 ELSE 0 END
    ) AS is_read
    FROM notifications n
    LEFT JOIN user_notifications un ON n.id = un.notification_id AND un.user_id = ?
    WHERE n.user_id IS NULL
    ORDER BY n.created_at DESC');
    $stmt->execute([$userId]);
    $broadcast = $stmt->fetchAll(PDO::FETCH_ASSOC);
    // Normalize targeted notifications to include `is_read` boolean
    foreach ($targeted as &$t) {
        $t['is_read'] = (bool)$t['is_read'];
    }
    // Merge arrays and ensure broadcast notifications have boolean is_read
    foreach ($broadcast as &$b) {
        $b['is_read'] = (bool)$b['is_read'];
    }
    return array_merge($targeted, $broadcast);
}

// Helper: determine the sub-path after /api
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$scriptDir = dirname($_SERVER['SCRIPT_NAME']); // typically '/api'
$path = substr($uri, strlen($scriptDir));
if ($path === false) $path = '/';

// Remove trailing slashes (except root)
if (strlen($path) > 1 && substr($path, -1) === '/') {
    $path = rtrim($path, '/');
}

$method = $_SERVER['REQUEST_METHOD'];
$db = get_db();

require_once __DIR__ . '/toc_utils.php';

// Enforce CSRF token for admin routes on state-changing methods. The admin
// frontend should obtain a token via GET /admin/csrf and include it in
// the X-CSRF-Token header for POST/PUT/DELETE requests. If validation
// fails, verify_csrf_token() will throw a 403 response.
if (preg_match('#^/admin#', $path) && !in_array($method, ['GET','OPTIONS'])) {
    verify_csrf_token();
}

// Utility function to check if a user has access to a paid book
function user_has_book_access(PDO $db, $userId, $bookId) {
    // Check direct purchase
    $stmt = $db->prepare('SELECT 1 FROM user_book_access WHERE user_id = ? AND book_id = ?');
    $stmt->execute([$userId, $bookId]);
    if ($stmt->fetch()) return true;
    // Check lifetime package
    $stmt = $db->prepare('SELECT p.access_type FROM user_packages up JOIN packages p ON up.package_id = p.id WHERE up.user_id = ?');
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $row) {
        if ($row['access_type'] === 'lifetime_all_access') {
            return true;
        }
    }
    return false;
}

// Require the current user to be an admin. If not authenticated or not admin, send 403.
function require_admin() {
    $user = get_authenticated_user();
    if (!$user) {
        send_json(['message' => 'Chưa đăng nhập.'], 401);
    }
    // Always check the latest role from DB to avoid stale session data
    try {
        $dbLocal = get_db();
        $stmt = $dbLocal->prepare('SELECT role FROM users WHERE id = ?');
        $stmt->execute([(int)$user['id']]);
        $freshRole = $stmt->fetchColumn();
        if ($freshRole) {
            // Update session role for consistency
            if (session_status() === PHP_SESSION_NONE) {
                session_start();
            }
            $_SESSION['user']['role'] = $freshRole;
        }
        if ($freshRole !== 'admin') {
            send_json(['message' => 'Bạn không có quyền truy cập trang này.'], 403);
        }
    } catch (Exception $e) {
        // If DB check fails, treat as unauthorized
        send_json(['message' => 'Không thể xác thực quyền truy cập.'], 403);
    }
    return $_SESSION['user'];
}

// Route handling
try {
    // REGISTER
    if ($path === '/register' && $method === 'POST') {
        $input = get_json_input();
        $email = isset($input['email']) ? trim($input['email']) : '';
        $password = isset($input['password']) ? $input['password'] : '';
        if (!$email || !$password) {
            send_json(['message' => 'Email và mật khẩu là bắt buộc.'], 400);
        }
        // Check existing user
        $stmt = $db->prepare('SELECT id FROM users WHERE email = ?');
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            send_json(['message' => 'Email này đã được đăng ký.'], 409);
        }
        $hash = password_hash($password, PASSWORD_BCRYPT);
        // Default role is 'user'
        $stmt = $db->prepare('INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, NOW())');
        $stmt->execute([$email, $hash, 'user']);
        $userId = $db->lastInsertId();
        // Start session and store user
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        $_SESSION['user'] = ['id' => (int)$userId, 'email' => $email, 'role' => 'user'];
        send_json(['user' => $_SESSION['user']], 201);
    }
    // LOGIN
    if ($path === '/login' && $method === 'POST') {
        $input = get_json_input();
        $email = isset($input['email']) ? trim($input['email']) : '';
        $password = isset($input['password']) ? $input['password'] : '';
        if (!$email || !$password) {
            send_json(['message' => 'Email và mật khẩu là bắt buộc.'], 400);
        }
        $stmt = $db->prepare('SELECT id, email, password_hash, role FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            send_json(['message' => 'Email hoặc mật khẩu không chính xác.'], 401);
        }
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        $_SESSION['user'] = ['id' => (int)$user['id'], 'email' => $user['email'], 'role' => $user['role']];
        send_json(['user' => $_SESSION['user']]);
    }
    // LOGOUT
    if ($path === '/logout' && $method === 'POST') {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $params['path'], $params['domain'],
                $params['secure'], $params['httponly']
            );
        }
        session_destroy();
        send_json(['message' => 'Đã đăng xuất.']);
    }
    // SESSION
    if ($path === '/session' && $method === 'GET') {
        $user = get_authenticated_user();
        // Always return 200 with user or null
        send_json(['user' => $user ?: null]);
    }
    // BOOKS LIST or BY ID
    if (preg_match('#^/books(/(?P<id>\d+))?$#', $path, $m) && $method === 'GET') {
        if (!empty($m['id'])) {
            // Single book
            $bookId = (int)$m['id'];
            $stmt = $db->prepare('SELECT * FROM books WHERE id = ?');
            $stmt->execute([$bookId]);
            $book = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$book) {
                send_json(['message' => 'Không tìm thấy sách.'], 404);
            }
            send_json($book);
        } else {
            // Book list
            $search = isset($_GET['search']) ? trim(strtolower($_GET['search'])) : null;
            $sql = 'SELECT id, title, author, description, cover_image_url, access_level, price, created_at FROM books WHERE is_published = 1';
            $params = [];
            if ($search) {
                $sql .= ' AND (LOWER(title) LIKE ? OR LOWER(author) LIKE ?)';
                $params[] = '%' . $search . '%';
                $params[] = '%' . $search . '%';
            }
            $sql .= ' ORDER BY created_at DESC';
            $stmt = $db->prepare($sql);
            $stmt->execute($params);
            $books = $stmt->fetchAll(PDO::FETCH_ASSOC);
            send_json($books);
        }
    }
    // PACKAGES BY ID
    if (preg_match('#^/packages/(?P<id>\d+)$#', $path, $m) && $method === 'GET') {
        $packageId = (int)$m['id'];
        // Attempt to fetch the package from DB
        $stmt = $db->prepare('SELECT * FROM packages WHERE id = ?');
        $stmt->execute([$packageId]);
        $pkg = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$pkg) {
            // If the package with ID 1 is requested and does not exist,
            // automatically insert a default founder package into the database.
            if ($packageId === 1) {
                // Insert founder package if missing
                $db->prepare(
                    'INSERT INTO packages (id, name, description, access_type, total_slots, price, is_active) '
                    . 'VALUES (1, \"Gói Sáng lập\", \"Gói sáng lập truy cập trọn đời vào tất cả sách trả phí.\", '
                    . '\"lifetime_all_access\", NULL, 0, 1) '
                    . 'ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description), access_type=VALUES(access_type), '
                    . 'total_slots=VALUES(total_slots), price=VALUES(price), is_active=VALUES(is_active)'
                )->execute();
                // Attempt to fetch again
                $stmt = $db->prepare('SELECT * FROM packages WHERE id = ?');
                $stmt->execute([$packageId]);
                $pkg = $stmt->fetch(PDO::FETCH_ASSOC);
            }
        }
        if (!$pkg) {
            send_json(['message' => 'Không tìm thấy gói.'], 404);
        }
        send_json($pkg);
    }
    // USER BOOKS
    if ($path === '/user/books' && $method === 'GET') {
        $user = get_authenticated_user();
        if (!$user) {
            send_json(['message' => 'Chưa đăng nhập.'], 401);
        }
        $userId = (int)$user['id'];
        $stmt = $db->prepare('SELECT book_id FROM user_book_access WHERE user_id = ?');
        $stmt->execute([$userId]);
        $ids = $stmt->fetchAll(PDO::FETCH_COLUMN, 0);
        // Check lifetime
        $stmt = $db->prepare('SELECT p.access_type FROM user_packages up JOIN packages p ON up.package_id = p.id WHERE up.user_id = ?');
        $stmt->execute([$userId]);
        $hasLifetime = false;
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if ($row['access_type'] === 'lifetime_all_access') {
                $hasLifetime = true;
                break;
            }
        }
        send_json(['bookIds' => array_map('intval', $ids), 'hasLifetime' => $hasLifetime]);
    }
    // USER PACKAGES
    if ($path === '/user/packages' && $method === 'GET') {
        $user = get_authenticated_user();
        if (!$user) {
            send_json(['message' => 'Chưa đăng nhập.'], 401);
        }
        $userId = (int)$user['id'];
        $stmt = $db->prepare('SELECT p.* FROM user_packages up JOIN packages p ON up.package_id = p.id WHERE up.user_id = ?');
        $stmt->execute([$userId]);
        $pkgs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        send_json($pkgs);
    }
    // TOC
    if (preg_match('#^/toc/(?P<id>\d+)$#', $path, $m) && $method === 'GET') {
        $bookId = (int)$m['id'];
        // Fetch book info
        $stmt = $db->prepare('SELECT id, access_level, toc_path, toc_json FROM books WHERE id = ?');
        $stmt->execute([$bookId]);
        $book = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$book) {
            send_json(['message' => 'Không tìm thấy sách.'], 404);
        }
        // Access control
        if ($book['access_level'] !== 'free') {
            $user = get_authenticated_user();
            if (!$user) {
                send_json(['message' => 'Cần đăng nhập để truy cập sách này.'], 401);
            }
            $has = user_has_book_access($db, (int)$user['id'], $bookId);
            if (!$has) {
                send_json(['message' => 'Bạn không có quyền truy cập sách này.'], 403);
            }
        }
        // Return toc_json if available
        if (!empty($book['toc_json'])) {
            $toc = is_string($book['toc_json']) ? json_decode($book['toc_json'], true) : $book['toc_json'];
            if ($toc) {
                send_json($toc);
            }
        }
        // If no JSON stored, inform admin that import may be required
        send_json(['message' => 'Mục lục chưa được nhập vào hệ thống.'], 404);
    }
    // CHAPTER
    if ($path === '/chapter' && $method === 'GET') {
        $bookId = isset($_GET['book_id']) ? (int)$_GET['book_id'] : 0;
        $chapterNumber = isset($_GET['chapter']) ? (int)$_GET['chapter'] : 0;
        if (!$bookId || !$chapterNumber) {
            send_json(['message' => 'Thiếu tham số book_id hoặc chapter.'], 400);
        }
        // Fetch book for access level
        $stmt = $db->prepare('SELECT id, access_level, toc_path FROM books WHERE id = ?');
        $stmt->execute([$bookId]);
        $book = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$book) {
            send_json(['message' => 'Không tìm thấy sách.'], 404);
        }
        if ($book['access_level'] !== 'free') {
            $user = get_authenticated_user();
            if (!$user) {
                send_json(['message' => 'Cần đăng nhập để truy cập chương này.'], 401);
            }
            if (!user_has_book_access($db, (int)$user['id'], $bookId)) {
                send_json(['message' => 'Bạn không có quyền truy cập chương này.'], 403);
            }
        }
        // Always read chapter content from DB
        $stmt = $db->prepare('SELECT content FROM chapters WHERE book_id = ? AND chapter_number = ?');
        $stmt->execute([$bookId, $chapterNumber]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row && $row['content']) {
            $raw = $row['content'];
            $data = is_string($raw) ? json_decode($raw, true) : $raw;
            if ($data) {
                send_json($data);
            }
        }
        // If not found in DB, inform admin to import
        send_json(['message' => 'Chương này chưa được nhập vào hệ thống.'], 404);
    }

    // ========== Reading Progress Endpoints ==========
    // Get reading progress for a specific book (last chapter and scroll) for the current user
    if (preg_match('#^/progress/(?P<bookId>\d+)$#', $path, $m) && $method === 'GET') {
        $user = get_authenticated_user();
        if (!$user) {
            send_json(['message' => 'Chưa đăng nhập.'], 401);
        }
        $bookId = (int)$m['bookId'];
        $stmt = $db->prepare('SELECT last_chapter_id, last_scroll_position FROM user_reading_progress WHERE user_id = ? AND book_id = ?');
        $stmt->execute([(int)$user['id'], $bookId]);
        $progress = $stmt->fetch(PDO::FETCH_ASSOC);
        send_json($progress ? $progress : null);
    }
    // Update reading progress for a book. Expects JSON with book_id, last_chapter_id, last_scroll_position
    if ($path === '/progress' && ($method === 'POST' || $method === 'PUT')) {
        $user = get_authenticated_user();
        if (!$user) {
            send_json(['message' => 'Chưa đăng nhập.'], 401);
        }
        $input = get_json_input();
        $bookId = isset($input['book_id']) ? (int)$input['book_id'] : 0;
        $lastChapterId = isset($input['last_chapter_id']) ? $input['last_chapter_id'] : null;
        $lastScroll = isset($input['last_scroll_position']) ? $input['last_scroll_position'] : null;
        if (!$bookId) {
            send_json(['message' => 'Thiếu tham số book_id.'], 400);
        }
        $stmt = $db->prepare('INSERT INTO user_reading_progress (user_id, book_id, last_chapter_id, last_scroll_position, updated_at) VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE last_chapter_id = VALUES(last_chapter_id), last_scroll_position = VALUES(last_scroll_position), updated_at = NOW()');
        $stmt->execute([(int)$user['id'], $bookId, $lastChapterId, $lastScroll]);
        send_json(['message' => 'Đã lưu tiến độ đọc.']);
    }

    // ========== Notifications Endpoints ==========
    // Get notifications for current user
    if ($path === '/notifications' && $method === 'GET') {
        $user = get_authenticated_user();
        if (!$user) {
            send_json(['message' => 'Chưa đăng nhập.'], 401);
        }
        $notifs = get_notifications_for_user($db, (int)$user['id']);
        send_json($notifs);
    }
    // Mark a notification as read
    if (preg_match('#^/notifications/(?P<id>\d+)/read$#', $path, $m) && $method === 'POST') {
        $user = get_authenticated_user();
        if (!$user) {
            send_json(['message' => 'Chưa đăng nhập.'], 401);
        }
        $notifId = (int)$m['id'];
        mark_notification_read($db, $notifId, (int)$user['id']);
        send_json(['message' => 'Đã đánh dấu thông báo.']);
    }

    // ========== Admin Endpoints ==========

    // Upload cover image for a book. Expects multipart/form-data with 'cover' file.
    // Returns { url: '/uploads/covers/filename.ext' } on success.
    if ($path === '/admin/upload-cover' && $method === 'POST') {
        // Require admin user
        $admin = require_admin();
        // Ensure a file is uploaded
        if (!isset($_FILES['cover']) || !is_array($_FILES['cover']) || $_FILES['cover']['error'] !== UPLOAD_ERR_OK) {
            send_json(['message' => 'Chưa chọn tệp ảnh bìa hoặc tệp bị lỗi.'], 400);
        }
        $file = $_FILES['cover'];
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        // Only allow common image formats
        $allowed = ['jpg', 'jpeg', 'png', 'webp'];
        if (!in_array($ext, $allowed)) {
            send_json(['message' => 'Định dạng ảnh không hỗ trợ. Chỉ cho phép jpg, jpeg, png, webp.'], 400);
        }
        // Generate unique filename
        $unique = 'cover_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
        $uploadDir = realpath(__DIR__ . '/../..') . '/uploads/covers';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0775, true);
        }
        $destPath = $uploadDir . '/' . $unique;
        if (!move_uploaded_file($file['tmp_name'], $destPath)) {
            send_json(['message' => 'Không thể lưu tệp ảnh.'], 500);
        }
        // Build public URL relative to project root (served from /uploads/covers)
        $publicUrl = '/uploads/covers/' . $unique;
        send_json(['url' => $publicUrl]);
    }
    // List all books (regardless of published status)
    if ($path === '/admin/books' && $method === 'GET') {
        $admin = require_admin();
        $stmt = $db->query('SELECT * FROM books ORDER BY created_at DESC');
        $books = $stmt->fetchAll(PDO::FETCH_ASSOC);
        send_json($books);
    }
    // Create a new book or import from folder
    if ($path === '/admin/books' && $method === 'POST') {
        $admin = require_admin();
        $input = get_json_input();
        // Expected fields: title, author, description, template_path, access_level, price, is_published, folder (optional), send_notification
        $title = isset($input['title']) ? trim($input['title']) : null;
        $accessLevel = isset($input['access_level']) ? $input['access_level'] : 'free';
        $isPublished = !empty($input['is_published']);
        $author = isset($input['author']) ? $input['author'] : null;
        $description = isset($input['description']) ? $input['description'] : null;
        // Use new default template if none provided
        $templatePath = isset($input['template_path']) && $input['template_path'] ? $input['template_path'] : '/assets/templates/default-ebook-template.html';
        $price = isset($input['price']) ? (float)$input['price'] : 0;
        $folder = isset($input['folder']) ? $input['folder'] : null;
        $sendNotification = isset($input['send_notification']) ? (bool)$input['send_notification'] : false;
        $coverImageUrl = isset($input['cover_image_url']) && $input['cover_image_url'] ? $input['cover_image_url'] : null;
        try {
            if ($folder) {
                // Import using folder
                $newBookId = import_book_from_folder($db, $folder, null, $accessLevel, $isPublished);
                // Update author, description, price, template if provided
                $stmt = $db->prepare('UPDATE books SET author=?, description=?, template_path=?, price=?, cover_image_url=IFNULL(?, cover_image_url) WHERE id=?');
                $stmt->execute([$author, $description, $templatePath, $price, $coverImageUrl, $newBookId]);
                $bookId = $newBookId;
            } else {
                // Create book record without importing chapters
                $stmt = $db->prepare('INSERT INTO books (title, author, description, template_path, access_level, price, is_published, cover_image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                $stmt->execute([$title, $author, $description, $templatePath, $accessLevel, $price, $isPublished ? 1 : 0, $coverImageUrl]);
                $bookId = (int)$db->lastInsertId();
            }
            // Send notification to all users if requested
            if ($sendNotification) {
                $msg = 'Sách mới được phát hành: ' . ($title ?: 'ID ' . $bookId);
                $link = '/reader.html?bookId=' . $bookId;
                add_notification($db, 'Sách mới', $msg, $link, null);
            }
            send_json(['book_id' => $bookId], 201);
        } catch (Exception $e) {
            send_json(['message' => 'Lỗi tạo sách', 'detail' => $e->getMessage()], 500);
        }
    }
    // Update a book by ID. Accepts same fields as creation plus optional folder for re-import.
    if (preg_match('#^/admin/books/(?P<id>\d+)$#', $path, $m) && $method === 'PUT') {
        $admin = require_admin();
        $bookId = (int)$m['id'];
        $input = get_json_input();
        $title = isset($input['title']) ? trim($input['title']) : null;
        $accessLevel = isset($input['access_level']) ? $input['access_level'] : null;
        $isPublished = isset($input['is_published']) ? (bool)$input['is_published'] : null;
        $author = isset($input['author']) ? $input['author'] : null;
        $description = isset($input['description']) ? $input['description'] : null;
        // Template path: if not provided, leave unchanged; else use provided value (default template should already be stored)
        $templatePath = isset($input['template_path']) ? $input['template_path'] : null;
        $price = isset($input['price']) ? (float)$input['price'] : null;
        $folder = isset($input['folder']) ? $input['folder'] : null;
        $sendNotification = isset($input['send_notification']) ? (bool)$input['send_notification'] : false;
        $coverImageUrl = isset($input['cover_image_url']) && $input['cover_image_url'] ? $input['cover_image_url'] : null;
        try {
            if ($folder) {
                // Re-import book
                import_book_from_folder($db, $folder, $bookId, $accessLevel ?: 'free', $isPublished);
            }
            // Build update fields array
            $updates = [];
            $params = [];
            if ($title !== null) { $updates[] = 'title=?'; $params[] = $title; }
            if ($author !== null) { $updates[] = 'author=?'; $params[] = $author; }
            if ($description !== null) { $updates[] = 'description=?'; $params[] = $description; }
            if ($templatePath !== null) { $updates[] = 'template_path=?'; $params[] = $templatePath; }
            if ($accessLevel !== null) { $updates[] = 'access_level=?'; $params[] = $accessLevel; }
            if ($price !== null) { $updates[] = 'price=?'; $params[] = $price; }
            if ($isPublished !== null) { $updates[] = 'is_published=?'; $params[] = $isPublished ? 1 : 0; }
            if ($coverImageUrl !== null) { $updates[] = 'cover_image_url=?'; $params[] = $coverImageUrl; }
            if (!empty($updates)) {
                $params[] = $bookId;
                $stmt = $db->prepare('UPDATE books SET ' . implode(', ', $updates) . ' WHERE id = ?');
                $stmt->execute($params);
            }
            if ($sendNotification) {
                $msg = 'Sách được cập nhật: ID ' . $bookId;
                $link = '/reader.html?bookId=' . $bookId;
                add_notification($db, 'Cập nhật sách', $msg, $link, null);
            }
            send_json(['message' => 'Đã cập nhật sách.']);
        } catch (Exception $e) {
            send_json(['message' => 'Lỗi cập nhật sách', 'detail' => $e->getMessage()], 500);
        }
    }
    // Delete a book
    if (preg_match('#^/admin/books/(?P<id>\d+)$#', $path, $m) && $method === 'DELETE') {
        $admin = require_admin();
        $bookId = (int)$m['id'];
        $stmt = $db->prepare('DELETE FROM books WHERE id = ?');
        $stmt->execute([$bookId]);
        send_json(['message' => 'Đã xoá sách.']);
    }
    // List users
    if ($path === '/admin/users' && $method === 'GET') {
        $admin = require_admin();
        $stmt = $db->query('SELECT id, email, role, created_at FROM users ORDER BY created_at DESC');
        $users = $stmt->fetchAll(PDO::FETCH_ASSOC);
        send_json($users);
    }

    // Create a new user (Admin). Body: { email, password, role? }
    if ($path === '/admin/users' && $method === 'POST') {
        $admin = require_admin();
        $input = get_json_input();
        $email = isset($input['email']) ? trim($input['email']) : '';
        $password = isset($input['password']) ? $input['password'] : '';
        $role = isset($input['role']) ? trim($input['role']) : 'user';
        if ($email === '' || $password === '') {
            send_json(['message' => 'Thiếu email hoặc mật khẩu.'], 400);
        }
        // Only allow roles user or admin
        if (!in_array($role, ['user', 'admin'])) {
            send_json(['message' => 'Vai trò không hợp lệ.'], 400);
        }
        // Check for existing email
        $stmt = $db->prepare('SELECT id FROM users WHERE email = ?');
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            send_json(['message' => 'Email đã tồn tại.'], 409);
        }
        $hash = password_hash($password, PASSWORD_BCRYPT);
        $stmt = $db->prepare('INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, NOW())');
        $stmt->execute([$email, $hash, $role]);
        $uid = (int)$db->lastInsertId();
        send_json(['user_id' => $uid], 201);
    }

    // Update user email and/or role (Admin). Body may include { email, role }
    if (preg_match('#^/admin/users/(?P<uid>\d+)$#', $path, $m) && $method === 'PUT') {
        $admin = require_admin();
        $uid = (int)$m['uid'];
        $input = get_json_input();
        $email = isset($input['email']) ? trim($input['email']) : null;
        $role = isset($input['role']) ? $input['role'] : null;
        if ($email === null && $role === null) {
            send_json(['message' => 'Không có dữ liệu để cập nhật.'], 400);
        }
        // Validate role if provided
        if ($role !== null && !in_array($role, ['user','admin'])) {
            send_json(['message' => 'Vai trò không hợp lệ.'], 400);
        }
        // If updating email, ensure it is not used by others
        if ($email !== null) {
            if ($email === '') {
                send_json(['message' => 'Email không hợp lệ.'], 400);
            }
            $stmt = $db->prepare('SELECT id FROM users WHERE email = ? AND id <> ?');
            $stmt->execute([$email, $uid]);
            if ($stmt->fetch()) {
                send_json(['message' => 'Email đã tồn tại.'], 409);
            }
        }
        $updates = [];
        $params = [];
        if ($email !== null) { $updates[] = 'email = ?'; $params[] = $email; }
        if ($role !== null) { $updates[] = 'role = ?'; $params[] = $role; }
        if (!empty($updates)) {
            $params[] = $uid;
            $stmt = $db->prepare('UPDATE users SET ' . implode(', ', $updates) . ' WHERE id = ?');
            $stmt->execute($params);
        }
        send_json(['message' => 'Đã cập nhật người dùng.']);
    }

    // Update user password (Admin). Body: { password }
    if (preg_match('#^/admin/users/(?P<uid>\d+)/password$#', $path, $m) && $method === 'PUT') {
        $admin = require_admin();
        $uid = (int)$m['uid'];
        $input = get_json_input();
        $password = isset($input['password']) ? $input['password'] : '';
        if (!$password) {
            send_json(['message' => 'Thiếu mật khẩu mới.'], 400);
        }
        $hash = password_hash($password, PASSWORD_BCRYPT);
        $stmt = $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $stmt->execute([$hash, $uid]);
        send_json(['message' => 'Đã cập nhật mật khẩu cho người dùng.']);
    }

    // Delete a user (Admin)
    if (preg_match('#^/admin/users/(?P<uid>\d+)$#', $path, $m) && $method === 'DELETE') {
        $admin = require_admin();
        $uid = (int)$m['uid'];
        // Prevent deleting self
        if ($admin['id'] == $uid) {
            send_json(['message' => 'Không thể xoá chính bạn.'], 400);
        }
        // Remove user entitlements
        $stmt = $db->prepare('DELETE FROM user_book_access WHERE user_id = ?');
        $stmt->execute([$uid]);
        $stmt = $db->prepare('DELETE FROM user_packages WHERE user_id = ?');
        $stmt->execute([$uid]);
        $stmt = $db->prepare('DELETE FROM user_notifications WHERE user_id = ?');
        $stmt->execute([$uid]);
        $stmt = $db->prepare('DELETE FROM notifications WHERE user_id = ?');
        $stmt->execute([$uid]);
        $stmt = $db->prepare('DELETE FROM users WHERE id = ?');
        $stmt->execute([$uid]);
        send_json(['message' => 'Đã xoá người dùng.']);
    }
    // Update user role
    if (preg_match('#^/admin/users/(?P<uid>\d+)/role$#', $path, $m) && $method === 'PUT') {
        $admin = require_admin();
        $userId = (int)$m['uid'];
        $input = get_json_input();
        $newRole = isset($input['role']) ? $input['role'] : null;
        if (!$newRole || !in_array($newRole, ['user','admin'])) {
            send_json(['message' => 'Role không hợp lệ.'], 400);
        }
        $stmt = $db->prepare('UPDATE users SET role = ? WHERE id = ?');
        $stmt->execute([$newRole, $userId]);
        send_json(['message' => 'Đã cập nhật role cho người dùng.']);
    }
    // Assign book to user
    if (preg_match('#^/admin/users/(?P<uid>\d+)/books$#', $path, $m) && $method === 'POST') {
        $admin = require_admin();
        $userId = (int)$m['uid'];
        $input = get_json_input();
        $bookId = isset($input['book_id']) ? (int)$input['book_id'] : 0;
        if (!$bookId) {
            send_json(['message' => 'Thiếu book_id.'], 400);
        }
        $stmt = $db->prepare('INSERT IGNORE INTO user_book_access (user_id, book_id) VALUES (?, ?)');
        $stmt->execute([$userId, $bookId]);
        send_json(['message' => 'Đã gán sách cho người dùng.']);
    }
    // Remove book from user
    if (preg_match('#^/admin/users/(?P<uid>\d+)/books/(?P<bid>\d+)$#', $path, $m) && $method === 'DELETE') {
        $admin = require_admin();
        $userId = (int)$m['uid'];
        $bookId = (int)$m['bid'];
        $stmt = $db->prepare('DELETE FROM user_book_access WHERE user_id = ? AND book_id = ?');
        $stmt->execute([$userId, $bookId]);
        send_json(['message' => 'Đã xoá quyền truy cập sách của người dùng.']);
    }
    // Assign package to user
    if (preg_match('#^/admin/users/(?P<uid>\d+)/packages$#', $path, $m) && $method === 'POST') {
        $admin = require_admin();
        $userId = (int)$m['uid'];
        $input = get_json_input();
        $packageId = isset($input['package_id']) ? (int)$input['package_id'] : 0;
        if (!$packageId) {
            send_json(['message' => 'Thiếu package_id.'], 400);
        }
        $stmt = $db->prepare('INSERT IGNORE INTO user_packages (user_id, package_id) VALUES (?, ?)');
        $stmt->execute([$userId, $packageId]);
        send_json(['message' => 'Đã gán gói cho người dùng.']);
    }
    // Remove package from user
    if (preg_match('#^/admin/users/(?P<uid>\d+)/packages/(?P<pid>\d+)$#', $path, $m) && $method === 'DELETE') {
        $admin = require_admin();
        $userId = (int)$m['uid'];
        $packageId = (int)$m['pid'];
        $stmt = $db->prepare('DELETE FROM user_packages WHERE user_id = ? AND package_id = ?');
        $stmt->execute([$userId, $packageId]);
        send_json(['message' => 'Đã xoá gói khỏi người dùng.']);
    }

    // Get entitlements for a user: list books and packages assigned to the user. (Admin only)
    if (preg_match('#^/admin/users/(?P<uid>\d+)/entitlements$#', $path, $m) && $method === 'GET') {
        $admin = require_admin();
        $userId = (int)$m['uid'];
        // Fetch assigned books
        $stmt = $db->prepare('SELECT b.id, b.title, b.access_level FROM books b
            JOIN user_book_access uba ON uba.book_id = b.id
            WHERE uba.user_id = ?');
        $stmt->execute([$userId]);
        $books = $stmt->fetchAll(PDO::FETCH_ASSOC);
        // Fetch assigned packages
        $stmt = $db->prepare('SELECT p.id, p.name, p.access_type, p.is_active FROM packages p
            JOIN user_packages up ON up.package_id = p.id
            WHERE up.user_id = ?');
        $stmt->execute([$userId]);
        $packages = $stmt->fetchAll(PDO::FETCH_ASSOC);
        send_json(['books' => $books, 'packages' => $packages]);
    }

    // Search books by title or ID for autocomplete when assigning
    if ($path === '/admin/search/books' && $method === 'GET') {
        $admin = require_admin();
        $query = isset($_GET['q']) ? trim($_GET['q']) : '';
        $limit = isset($_GET['limit']) ? max(1, (int)$_GET['limit']) : 10;
        if ($query === '') {
            // Return top books by recent creation
            $stmt = $db->prepare('SELECT id, title FROM books ORDER BY created_at DESC LIMIT ?');
            $stmt->execute([$limit]);
        } else {
            $like = '%' . strtolower($query) . '%';
            $stmt = $db->prepare('SELECT id, title FROM books WHERE LOWER(title) LIKE ? OR CAST(id AS CHAR) LIKE ? ORDER BY title ASC LIMIT ?');
            $stmt->execute([$like, $like, $limit]);
        }
        $results = $stmt->fetchAll(PDO::FETCH_ASSOC);
        send_json($results);
    }

    // Search packages by name or ID for autocomplete when assigning
    if ($path === '/admin/search/packages' && $method === 'GET') {
        $admin = require_admin();
        $query = isset($_GET['q']) ? trim($_GET['q']) : '';
        $limit = isset($_GET['limit']) ? max(1, (int)$_GET['limit']) : 10;
        if ($query === '') {
            $stmt = $db->prepare('SELECT id, name FROM packages ORDER BY id DESC LIMIT ?');
            $stmt->execute([$limit]);
        } else {
            $like = '%' . strtolower($query) . '%';
            $stmt = $db->prepare('SELECT id, name FROM packages WHERE LOWER(name) LIKE ? OR CAST(id AS CHAR) LIKE ? ORDER BY name ASC LIMIT ?');
            $stmt->execute([$like, $like, $limit]);
        }
        $results = $stmt->fetchAll(PDO::FETCH_ASSOC);
        send_json($results);
    }

    // ------------------- Package management (Admin) ---------------------
    // List all packages
    if ($path === '/admin/packages' && $method === 'GET') {
        $admin = require_admin();
        $stmt = $db->query('SELECT * FROM packages ORDER BY id DESC');
        $pkgs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        send_json($pkgs);
    }
    // Create a new package
    if ($path === '/admin/packages' && $method === 'POST') {
        $admin = require_admin();
        $input = get_json_input();
        $name = trim($input['name'] ?? '');
        $accessType = trim($input['access_type'] ?? '');
        $description = array_key_exists('description', $input) ? trim($input['description']) : null;
        $totalSlots = array_key_exists('total_slots', $input) ? ($input['total_slots'] === null ? null : (int)$input['total_slots']) : null;
        $price = isset($input['price']) ? (float)$input['price'] : 0;
        $isActive = isset($input['is_active']) ? (bool)$input['is_active'] : true;
        if (!$name || !$accessType) {
            send_json(['message' => 'Tên gói và loại truy cập là bắt buộc.'], 400);
        }
        $stmt = $db->prepare('INSERT INTO packages (name, description, access_type, total_slots, price, is_active) VALUES (?, ?, ?, ?, ?, ?)');
        try {
            $stmt->execute([$name, $description, $accessType, $totalSlots, $price, $isActive ? 1 : 0]);
        } catch (PDOException $e) {
            send_json(['message' => 'Lỗi tạo gói: ' . $e->getMessage()], 500);
        }
        send_json(['package_id' => (int)$db->lastInsertId()], 201);
    }
    // Get a single package
    if (preg_match('#^/admin/packages/(?P<pid>\d+)$#', $path, $m) && $method === 'GET') {
        $admin = require_admin();
        $pid = (int)$m['pid'];
        $stmt = $db->prepare('SELECT * FROM packages WHERE id = ?');
        $stmt->execute([$pid]);
        $pkg = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$pkg) {
            send_json(['message' => 'Không tìm thấy gói'], 404);
        }
        send_json($pkg);
    }
    // Update a package
    if (preg_match('#^/admin/packages/(?P<pid>\d+)$#', $path, $m) && $method === 'PUT') {
        $admin = require_admin();
        $pid = (int)$m['pid'];
        $input = get_json_input();
        $fields = [];
        $params = [];
        if (isset($input['name'])) { $fields[] = 'name = ?'; $params[] = trim($input['name']); }
        if (array_key_exists('description', $input)) { $fields[] = 'description = ?'; $params[] = $input['description'] !== null ? trim($input['description']) : null; }
        if (isset($input['access_type'])) { $fields[] = 'access_type = ?'; $params[] = trim($input['access_type']); }
        if (array_key_exists('total_slots', $input)) { $fields[] = 'total_slots = ?'; $params[] = $input['total_slots'] === null ? null : (int)$input['total_slots']; }
        if (isset($input['price'])) { $fields[] = 'price = ?'; $params[] = (float)$input['price']; }
        if (isset($input['is_active'])) { $fields[] = 'is_active = ?'; $params[] = $input['is_active'] ? 1 : 0; }
        if (empty($fields)) {
            send_json(['message' => 'Không có trường nào để cập nhật'], 400);
        }
        $params[] = $pid;
        $sql = 'UPDATE packages SET ' . implode(', ', $fields) . ' WHERE id = ?';
        $stmt = $db->prepare($sql);
        try {
            $stmt->execute($params);
        } catch (PDOException $e) {
            send_json(['message' => 'Lỗi cập nhật gói: ' . $e->getMessage()], 500);
        }
        send_json(['ok' => true]);
    }
    // Delete a package
    if (preg_match('#^/admin/packages/(?P<pid>\d+)$#', $path, $m) && $method === 'DELETE') {
        $admin = require_admin();
        $pid = (int)$m['pid'];
        // Remove assignments
        $stmt = $db->prepare('DELETE FROM user_packages WHERE package_id = ?');
        $stmt->execute([$pid]);
        $stmt = $db->prepare('DELETE FROM packages WHERE id = ?');
        $stmt->execute([$pid]);
        send_json(['ok' => true]);
    }
    // Admin create notification
    if ($path === '/admin/notifications' && $method === 'POST') {
        $admin = require_admin();
        $input = get_json_input();
        $title = isset($input['title']) ? trim($input['title']) : '';
        $message = isset($input['message']) ? $input['message'] : '';
        $linkUrl = isset($input['link_url']) ? $input['link_url'] : null;
        $targetUserId = isset($input['user_id']) && $input['user_id'] !== '' ? (int)$input['user_id'] : null;
        if (!$title || !$message) {
            send_json(['message' => 'Thiếu tiêu đề hoặc nội dung.'], 400);
        }
        $notifId = add_notification($db, $title, $message, $linkUrl, $targetUserId);
        send_json(['notification_id' => $notifId], 201);
    }
    // Admin list notifications
    if ($path === '/admin/notifications' && $method === 'GET') {
        $admin = require_admin();
        $stmt = $db->query('SELECT * FROM notifications ORDER BY created_at DESC');
        $list = $stmt->fetchAll(PDO::FETCH_ASSOC);
        send_json($list);
    }

    // ========== Admin Chapter Management ==========
    // List chapters for a given book ID
    if (preg_match('#^/admin/books/(?P<bid>\d+)/chapters$#', $path, $m) && $method === 'GET') {
        $admin = require_admin();
        $bookId = (int)$m['bid'];
        $stmt = $db->prepare('SELECT id, chapter_number, title FROM chapters WHERE book_id = ? ORDER BY chapter_number ASC');
        $stmt->execute([$bookId]);
        $chapters = $stmt->fetchAll(PDO::FETCH_ASSOC);
        send_json($chapters);
    }
    // Create a new chapter for a given book. Body: {chapter_number?, title, content}
    if (preg_match('#^/admin/books/(?P<bid>\d+)/chapters$#', $path, $m) && $method === 'POST') {
        $admin = require_admin();
        $bookId = (int)$m['bid'];
        $input = get_json_input();
        $desiredNumber = isset($input['chapter_number']) && $input['chapter_number'] !== '' ? (int)$input['chapter_number'] : null;
        $title = isset($input['title']) ? trim($input['title']) : '';
        $content = isset($input['content']) ? $input['content'] : null;
        // Find the unique number, collecting any warnings
        [$finalNumber, $warnings] = find_unique_chapter_number($db, $bookId, $desiredNumber);
        $stmt = $db->prepare('INSERT INTO chapters (book_id, chapter_number, title, content) VALUES (?, ?, ?, ?)');
        $stmt->execute([$bookId, $finalNumber, $title, json_encode($content, JSON_UNESCAPED_UNICODE)]);
        $result = ['chapter_id' => (int)$db->lastInsertId(), 'chapter_number' => $finalNumber];
        if (!empty($warnings)) {
            $result['warnings'] = $warnings;
        }
        rebuild_toc_hard($db, $bookId);
        send_json($result, 201);
    }
    // Import a single chapter JSON file. Expects multipart/form-data: file 'chapter' and optional 'chapter_number' & 'title'.
    if (preg_match('#^/admin/books/(?P<bid>\d+)/chapters/import-one$#', $path, $m) && $method === 'POST') {
        $admin = require_admin();
        $bookId = (int)$m['bid'];
        if (!isset($_FILES['chapter']) || $_FILES['chapter']['error'] !== UPLOAD_ERR_OK) {
            send_json(['message' => 'Thiếu tệp chương.'], 400);
        }
        $file = $_FILES['chapter'];
        $uploadedPath = $file['tmp_name'];
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        // Optional fields from multipart form
        $desiredNumber = isset($_POST['chapter_number']) && $_POST['chapter_number'] !== '' ? (int)$_POST['chapter_number'] : null;
        $title = isset($_POST['title']) ? trim($_POST['title']) : '';
        $chapterJson = null;
        // Parse content based on extension
        if ($ext === 'md') {
            // Parse Markdown to legacy JSON blocks
            require_once __DIR__ . '/helpers.php';
            $parsed = parse_markdown_file($uploadedPath);
            if (!$title && !empty($parsed['chapterTitle'])) {
                $title = $parsed['chapterTitle'];
            }
            $chapterJson = ['blocks' => $parsed['blocks']];
        } else {
            // Assume JSON file
            $data = file_get_contents($uploadedPath);
            $json = json_decode($data, true);
            if (!$json) {
                send_json(['message' => 'Tệp chương không hợp lệ (không phải JSON hoặc Markdown).'], 400);
            }
            // Extract title if not provided
            if (!$title && isset($json['chapterTitle'])) {
                $title = $json['chapterTitle'];
            }
            // Extract desired chapter number from JSON if not provided via POST
            if ($desiredNumber === null) {
                foreach (['chapter_number','chapterNumber','number'] as $numKey) {
                    if (isset($json[$numKey]) && is_numeric($json[$numKey])) {
                        $desiredNumber = (int)$json[$numKey];
                        break;
                    }
                }
            }
            $chapterJson = $json;
        }
        // Default title to empty if still missing
        if (!$title) { $title = ''; }
        // Determine final unique chapter number
        [$finalNum, $warnings] = find_unique_chapter_number($db, $bookId, $desiredNumber);
        $stmt = $db->prepare('INSERT INTO chapters (book_id, chapter_number, title, content) VALUES (?, ?, ?, ?)');
        $stmt->execute([$bookId, $finalNum, $title, json_encode($chapterJson, JSON_UNESCAPED_UNICODE)]);
        $result = ['chapter_id' => (int)$db->lastInsertId(), 'chapter_number' => $finalNum];
        if (!empty($warnings)) {
            $result['warnings'] = $warnings;
        }
        rebuild_toc_hard($db, $bookId);
        send_json($result, 201);
    }
    // Import multiple chapters from a zip archive. Expects 'zip' file. Filenames should contain chapter numbers or order alphabetically.
    if (preg_match('#^/admin/books/(?P<bid>\d+)/chapters/import-zip$#', $path, $m) && $method === 'POST') {
        $admin = require_admin();
        $bookId = (int)$m['bid'];
        if (!isset($_FILES['zip']) || $_FILES['zip']['error'] !== UPLOAD_ERR_OK) {
            send_json(['message' => 'Thiếu file zip.'], 400);
        }
        $zipFile = $_FILES['zip']['tmp_name'];
        // Create a temporary directory to extract
        $tmpDir = sys_get_temp_dir() . '/chap_import_' . uniqid();
        mkdir($tmpDir, 0775, true);
        $zip = new ZipArchive();
        if ($zip->open($zipFile) === TRUE) {
            $zip->extractTo($tmpDir);
            $zip->close();
        } else {
            send_json(['message' => 'Không thể giải nén file zip.'], 400);
        }
        $imported = 0;
        $warningsAll = [];
        // Iterate JSON files sorted alphabetically
        $files = glob($tmpDir . '/*.json');
        sort($files, SORT_NATURAL);
        foreach ($files as $fp) {
            $data = json_decode(file_get_contents($fp), true);
            if (!$data) continue;
            // Determine desired chapter number from file content if available
            $desiredNumber = null;
            foreach (['chapter_number','chapterNumber','number'] as $numKey) {
                if (isset($data[$numKey]) && is_numeric($data[$numKey])) {
                    $desiredNumber = (int)$data[$numKey];
                    break;
                }
            }
            $title = '';
            if (isset($data['chapterTitle']) && $data['chapterTitle']) {
                $title = $data['chapterTitle'];
            } elseif (isset($data['title']) && $data['title']) {
                $title = $data['title'];
            }
            [$finalNum, $warnings] = find_unique_chapter_number($db, $bookId, $desiredNumber);
            $stmt = $db->prepare('INSERT INTO chapters (book_id, chapter_number, title, content) VALUES (?, ?, ?, ?)');
            $stmt->execute([$bookId, $finalNum, $title, json_encode($data, JSON_UNESCAPED_UNICODE)]);
            $imported++;
            if (!empty($warnings)) {
                $warningsAll = array_merge($warningsAll, $warnings);
            }
        }
        // Clean up temp dir
        array_map('unlink', glob($tmpDir . '/*'));
        @rmdir($tmpDir);
        $res = ['imported' => $imported];
        if (!empty($warningsAll)) {
            $res['warnings'] = $warningsAll;
        }
        rebuild_toc_hard($db, $bookId);
        send_json($res, 201);
    }

    // Import multiple chapters from a server folder. Expects JSON body { folder: 'relative/path' }.
    if (preg_match('#^/admin/books/(?P<bid>\d+)/chapters/import-folder$#', $path, $m) && $method === 'POST') {
        $admin = require_admin();
        $bookId = (int)$m['bid'];
        $input = get_json_input();
        $folder = isset($input['folder']) ? trim($input['folder']) : '';
        if (!$folder) {
            send_json(['message' => 'Thiếu thư mục import.'], 400);
        }
        $projectRoot = realpath(__DIR__ . '/..');
        // Normalize path within project
        $folderPath = realpath($projectRoot . '/' . ltrim($folder, '/'));
        if (!$folderPath || !is_dir($folderPath)) {
            send_json(['message' => 'Thư mục import không tồn tại: ' . $folder], 400);
        }
        $imported = 0;
        $warningsAll = [];
        // Gather md and json files
        $files = array_merge(glob($folderPath . '/*.json'), glob($folderPath . '/*.md'));
        // Sort naturally by filename to maintain order
        natcasesort($files);
        foreach ($files as $fp) {
            if (!is_file($fp)) continue;
            $ext = strtolower(pathinfo($fp, PATHINFO_EXTENSION));
            $title = '';
            $contentObj = null;
            $desiredNumber = null;
            if ($ext === 'md') {
                require_once __DIR__ . '/helpers.php';
                $parsed = parse_markdown_file($fp);
                $title = $parsed['chapterTitle'];
                $contentObj = ['blocks' => $parsed['blocks']];
                // For markdown, desiredNumber stays null and will be assigned next available
            } else {
                $data = file_get_contents($fp);
                $json = json_decode($data, true);
                if (!$json) continue;
                if (isset($json['chapterTitle']) && $json['chapterTitle']) {
                    $title = $json['chapterTitle'];
                } elseif (isset($json['title']) && $json['title']) {
                    $title = $json['title'];
                }
                // Extract desired chapter number from JSON if available
                foreach (['chapter_number','chapterNumber','number'] as $numKey) {
                    if (isset($json[$numKey]) && is_numeric($json[$numKey])) {
                        $desiredNumber = (int)$json[$numKey];
                        break;
                    }
                }
                $contentObj = $json;
            }
            // Use filename (without extension) as title fallback if still empty
            if (!$title) {
                $title = basename($fp, '.' . $ext);
            }
            // Find unique chapter number
            [$finalNum, $warnings] = find_unique_chapter_number($db, $bookId, $desiredNumber);
            $stmt = $db->prepare('INSERT INTO chapters (book_id, chapter_number, title, content) VALUES (?, ?, ?, ?)');
            $stmt->execute([$bookId, $finalNum, $title, json_encode($contentObj, JSON_UNESCAPED_UNICODE)]);
            $imported++;
            if (!empty($warnings)) {
                $warningsAll = array_merge($warningsAll, $warnings);
            }
        }
        $res = ['imported' => $imported];
        if (!empty($warningsAll)) {
            $res['warnings'] = $warningsAll;
        }
        rebuild_toc_hard($db, $bookId);
        send_json($res, 201);
    }

    // Update book TOC JSON after creation. Expects JSON body { toc: {...} }
    if (preg_match('#^/admin/books/(?P<bid>\d+)/toc$#', $path, $m) && $method === 'PUT') {
        $admin = require_admin();
        $bookId = (int)$m['bid'];
        $input = get_json_input();
        if (!isset($input['toc'])) {
            send_json(['message' => 'Payload phải chứa trường toc.'], 400);
        }
        $toc = $input['toc'];
        // Validate JSONable
        $tocJson = json_encode($toc, JSON_UNESCAPED_UNICODE);
        if ($tocJson === false) {
            send_json(['message' => 'toc không hợp lệ.'], 400);
        }
        $stmt = $db->prepare('UPDATE books SET toc_json = ? WHERE id = ?');
        $stmt->execute([$tocJson, $bookId]);
        send_json(['ok' => true]);
    }

    // Import chapters from a folder on the server. Body: { folder: "relative/path" }
    if (preg_match('#^/admin/books/(?P<bid>\d+)/chapters/import-folder$#', $path, $m) && $method === 'POST') {
        $admin = require_admin();
        $bookId = (int)$m['bid'];
        $input = get_json_input();
        $folder = isset($input['folder']) ? trim($input['folder']) : '';
        if ($folder === '') {
            send_json(['message' => 'Thiếu đường dẫn thư mục.'], 400);
        }
        $projectRoot = realpath(__DIR__ . '/..');
        // Normalize path relative to project root
        $folderPath = realpath($projectRoot . '/' . ltrim($folder, '/'));
        if (!$folderPath || !is_dir($folderPath)) {
            send_json(['message' => 'Thư mục không tồn tại: ' . $folder], 400);
        }
        $imported = 0;
        $warningsAll = [];
        // List .json and .md files
        $files = array_merge(glob($folderPath . '/*.json'), glob($folderPath . '/*.md'));
        // Sort files naturally by name
        sort($files, SORT_NATURAL);
        foreach ($files as $filePath) {
            $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
            $title = basename($filePath, '.' . $ext);
            $contentObj = null;
            $desiredNumber = null;
            if ($ext === 'json') {
                $data = json_decode(file_get_contents($filePath), true);
                if (!$data) {
                    continue;
                }
                // Try to detect title
                if (isset($data['chapterTitle']) && $data['chapterTitle']) {
                    $title = $data['chapterTitle'];
                } elseif (isset($data['title']) && $data['title']) {
                    $title = $data['title'];
                }
                // Extract chapter number
                foreach (['chapter_number','chapterNumber','number'] as $numKey) {
                    if (isset($data[$numKey]) && is_numeric($data[$numKey])) {
                        $desiredNumber = (int)$data[$numKey];
                        break;
                    }
                }
                $contentObj = $data;
            } elseif ($ext === 'md') {
                $raw = file_get_contents($filePath);
                if ($raw === false) continue;
                // Detect first Markdown heading as title
                $lines = preg_split('/\r?\n/', $raw);
                foreach ($lines as $line) {
                    if (preg_match('/^\s*#\s+(.+)/', $line, $matches)) {
                        $title = trim($matches[1]);
                        break;
                    }
                }
                // Split by blank lines to paragraphs
                $paragraphs = preg_split('/\n\s*\n/', trim($raw));
                $blocks = [];
                foreach ($paragraphs as $para) {
                    $pTrim = trim($para);
                    if ($pTrim === '') continue;
                    $blocks[] = ['type' => 'paragraph', 'text' => $pTrim];
                }
                $contentObj = [
                    'chapterTitle' => $title,
                    'blocks' => $blocks
                ];
            } else {
                continue;
            }
            // Determine unique chapter number
            [$finalNum, $warnings] = find_unique_chapter_number($db, $bookId, $desiredNumber);
            // Insert into DB
            $stmt = $db->prepare('INSERT INTO chapters (book_id, chapter_number, title, content) VALUES (?, ?, ?, ?)');
            $stmt->execute([$bookId, $finalNum, $title, json_encode($contentObj, JSON_UNESCAPED_UNICODE)]);
            $imported++;
            if (!empty($warnings)) {
                $warningsAll = array_merge($warningsAll, $warnings);
            }
        }
        $res = ['imported' => $imported];
        if (!empty($warningsAll)) {
            $res['warnings'] = $warningsAll;
        }
        rebuild_toc_hard($db, $bookId);
        send_json($res, 201);
    }

    // Update TOC for a book. Body: { toc: <JSON Object> }
    if (preg_match('#^/admin/books/(?P<bid>\d+)/toc$#', $path, $m) && $method === 'PUT') {
        $admin = require_admin();
        $bookId = (int)$m['bid'];
        $input = get_json_input();
        if (!isset($input['toc']) || !is_array($input['toc'])) {
            send_json(['message' => 'Thiếu trường toc hoặc kiểu dữ liệu không hợp lệ.'], 400);
        }
        $tocJson = json_encode($input['toc'], JSON_UNESCAPED_UNICODE);
        // Also update toc_path to blank or existing (we keep existing path)
        $stmt = $db->prepare('UPDATE books SET toc_json = ? WHERE id = ?');
        $stmt->execute([$tocJson, $bookId]);
        send_json(['message' => 'Đã cập nhật TOC.']);
    }
    // Fetch TOC for a book. Returns the decoded toc_json field. Only admins can access.
    if (preg_match('#^/admin/books/(?P<bid>\d+)/toc$#', $path, $m) && $method === 'GET') {
        $admin = require_admin();
        $bookId = (int)$m['bid'];
        $stmt = $db->prepare('SELECT toc_json FROM books WHERE id = ?');
        $stmt->execute([$bookId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row || !$row['toc_json']) {
            send_json(['message' => 'Không tìm thấy TOC cho sách này.'], 404);
        }
        $toc = json_decode($row['toc_json'], true);
        if (!is_array($toc)) {
            send_json(['message' => 'TOC lưu trữ không hợp lệ.'], 500);
        }
        send_json(['toc' => $toc]);
    }
    // Endpoint to obtain CSRF token for admin. Must be authenticated. Returns { token }
    if ($path === '/admin/csrf' && $method === 'GET') {
        $admin = require_admin();
        $token = get_csrf_token();
        send_json(['token' => $token]);
    }
    // Reorder chapters: atomic update using separate handler. Accepts JSON object {items: [{id, chapter_number}, ...]}
    if (preg_match('#^/admin/books/(?P<bid>\d+)/chapters/reorder$#', $path, $m) && $method === 'PUT') {
        $admin = require_admin();
        // Delegate to safe reorder handler which performs two-phase renumber and JSON sync
        require_once __DIR__ . '/reorder_handler.php';
        handle_reorder($db, (int)$m['bid']);
        return;
    }
    // Get a single chapter for editing
    if (preg_match('#^/admin/chapters/(?P<cid>\d+)$#', $path, $m) && $method === 'GET') {
        $admin = require_admin();
        $cid = (int)$m['cid'];
        $stmt = $db->prepare('SELECT id, book_id, chapter_number, title, content FROM chapters WHERE id = ?');
        $stmt->execute([$cid]);
        $chapter = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$chapter) {
            send_json(['message' => 'Không tìm thấy chương.'], 404);
        }
        // Decode JSON content if stored as string
        if (isset($chapter['content']) && is_string($chapter['content'])) {
            $chapter['content'] = json_decode($chapter['content'], true);
        }
        send_json($chapter);
    }
    // Update a chapter (title and/or content). Accepts JSON body { title, content }
    if (preg_match('#^/admin/chapters/(?P<cid>\d+)$#', $path, $m) && $method === 'PUT') {
        $admin = require_admin();
        $cid = (int)$m['cid'];
        $input = get_json_input();
        $title = isset($input['title']) ? trim($input['title']) : null;
        $content = isset($input['content']) ? $input['content'] : null;
        $chapterNumber = isset($input['chapter_number']) && $input['chapter_number'] !== '' ? (int)$input['chapter_number'] : null;
        // Fetch current book_id to check duplicates
        $stmt = $db->prepare('SELECT book_id, chapter_number FROM chapters WHERE id = ?');
        $stmt->execute([$cid]);
        $current = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$current) {
            send_json(['message' => 'Không tìm thấy chương.'], 404);
        }
        $bookId = (int)$current['book_id'];
        $updates = [];
        $params = [];
        // If chapter number provided, find unique number
        $warnings = [];
        $finalNumber = null;
        if ($chapterNumber !== null) {
            [$uniqueNum, $w] = find_unique_chapter_number($db, $bookId, $chapterNumber);
            $finalNumber = $uniqueNum;
            $warnings = array_merge($warnings, $w);
        }
        if ($title !== null) { $updates[] = 'title = ?'; $params[] = $title; }
        if ($content !== null) { $updates[] = 'content = ?'; $params[] = json_encode($content, JSON_UNESCAPED_UNICODE); }
        if ($finalNumber !== null) { $updates[] = 'chapter_number = ?'; $params[] = $finalNumber; }
        if (empty($updates)) {
            send_json(['message' => 'Không có gì để cập nhật.'], 400);
        }
        $params[] = $cid;
        $stmt = $db->prepare('UPDATE chapters SET ' . implode(', ', $updates) . ' WHERE id = ?');
        $stmt->execute($params);
        $res = ['message' => 'Đã cập nhật chương.'];
        if (!empty($warnings)) {
            $res['warnings'] = $warnings;
        }
        rebuild_toc_hard($db, $bookId);
        send_json($res);
    }

    // Delete a single chapter by ID
    if (preg_match('#^/admin/chapters/(?P<cid>\d+)$#', $path, $m) && $method === 'DELETE') {
        $admin = require_admin();
        $cid = (int)$m['cid'];

        $stmt = $db->prepare('SELECT book_id FROM chapters WHERE id = ?');
        $stmt->execute([$cid]);
        $bookId = (int)($stmt->fetchColumn());

        $stmt = $db->prepare('DELETE FROM chapters WHERE id = ?');
        $stmt->execute([$cid]);

        if ($bookId) rebuild_toc_hard($db, $bookId);
        
        send_json(['ok' => true]);
    }
    // If none matched, 404
    send_json(['message' => 'API endpoint không tồn tại.'], 404);
} catch (Exception $ex) {
    send_json(['message' => 'Có lỗi xảy ra.', 'detail' => $ex->getMessage()], 500);
}