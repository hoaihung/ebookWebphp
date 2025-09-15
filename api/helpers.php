<?php
// For JWT support you can include jwt.php. In the current implementation
// we rely on PHP sessions, so this import is optional. Uncomment if needed.
// require_once __DIR__ . '/jwt.php';

/**
 * Send a JSON response and terminate the script.
 *
 * @param mixed $data The data to encode as JSON.
 * @param int $status HTTP status code (default 200).
 */
function send_json($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

/**
 * Read JSON from the request body and decode it into an associative array.
 * Returns an empty array on parse error.
 *
 * @return array
 */
function get_json_input() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/**
 * Parse a Markdown file into the legacy JSON chapter format.
 *
 * This helper converts simple Markdown syntax into a structure
 * compatible with EbookLib's legacy JSON format (blocks array).
 * It supports headings (#, ##, ###), quotes (>), callout blocks
 * using :::info/:::warn/:::success, unordered lists (- or *),
 * ordered lists (1., 2., ...), and plain paragraphs.
 *
 * The function also attempts to extract the chapter title from
 * the first level-1 heading ("# Heading"). If none is found,
 * an empty string is returned for the title.
 *
 * @param string $filePath Path to the Markdown file
 * @return array Associative array with keys 'chapterTitle' and 'blocks'
 */
function parse_markdown_file($filePath) {
    $content = file_get_contents($filePath);
    if ($content === false) {
        return ['chapterTitle' => '', 'blocks' => []];
    }
    // Normalize line endings and split into lines
    $lines = preg_split('/\r?\n/', $content);
    $blocks = [];
    $chapterTitle = '';
    $i = 0;
    $n = count($lines);
    while ($i < $n) {
        $line = trim($lines[$i]);
        // Skip blank lines
        if ($line === '') {
            $i++;
            continue;
        }
        // Callout block starting with :::info or :::warn or :::success
        if (preg_match('/^:::\s*(info|warn|success)/i', $line, $m)) {
            $level = strtolower($m[1]);
            $i++;
            $calloutLines = [];
            // Collect until closing :::
            while ($i < $n && !preg_match('/^:::/', trim($lines[$i]))) {
                $calloutLines[] = rtrim($lines[$i]);
                $i++;
            }
            // Skip closing ::: line
            if ($i < $n && preg_match('/^:::/', trim($lines[$i]))) {
                $i++;
            }
            $blocks[] = [
                'type'  => 'alert',
                'level' => $level === 'warn' ? 'warning' : ($level === 'info' ? 'info' : 'success'),
                'text'  => trim(implode("\n", $calloutLines))
            ];
            continue;
        }
        // Blockquote starting with >
        if (substr($line, 0, 1) === '>') {
            $quoteLines = [];
            while ($i < $n && trim($lines[$i]) !== '' && substr(trim($lines[$i]), 0, 1) === '>') {
                $quoteLines[] = ltrim(trim($lines[$i]), '> ');
                $i++;
            }
            $blocks[] = [
                'type' => 'quote',
                'text' => implode("\n", $quoteLines)
            ];
            continue;
        }
        // Unordered list starting with - or *
        if (preg_match('/^[-*]\s+/', $line)) {
            $items = [];
            while ($i < $n && preg_match('/^[-*]\s+/', trim($lines[$i]))) {
                $itemLine = preg_replace('/^[-*]\s+/', '', trim($lines[$i]));
                $items[] = $itemLine;
                $i++;
            }
            $blocks[] = [
                'type'  => 'list',
                'items' => $items
            ];
            continue;
        }
        // Ordered list starting with digits.
        if (preg_match('/^\d+\.\s+/', $line)) {
            $items = [];
            while ($i < $n && preg_match('/^\d+\.\s+/', trim($lines[$i]))) {
                $itemLine = preg_replace('/^\d+\.\s+/', '', trim($lines[$i]));
                $items[] = $itemLine;
                $i++;
            }
            $blocks[] = [
                'type'  => 'list',
                'items' => $items
            ];
            continue;
        }
        // Headings (#, ##, ###)
        if (preg_match('/^(#{1,3})\s+(.*)/', $line, $m)) {
            $level = strlen($m[1]);
            $text  = trim($m[2]);
            if ($level === 1 && $chapterTitle === '') {
                $chapterTitle = $text;
            }
            // Use 'subheading' for all heading levels
            $blocks[] = [
                'type' => 'subheading',
                'text' => $text
            ];
            $i++;
            continue;
        }
        // Plain paragraph: gather until blank line or next special token
        $paraLines = [];
        while ($i < $n) {
            $curLine = trim($lines[$i]);
            if ($curLine === '' || preg_match('/^(-|\d+\.|>|:::)\s*/', $curLine) || preg_match('/^#{1,3}\s+/', $curLine)) {
                break;
            }
            $paraLines[] = rtrim($lines[$i]);
            $i++;
        }
        if (!empty($paraLines)) {
            $blocks[] = [
                'type' => 'paragraph',
                'text' => trim(implode("\n", $paraLines))
            ];
            continue;
        }
        // Fallback to skip unknown line
        $i++;
    }
    return ['chapterTitle' => $chapterTitle, 'blocks' => $blocks];
}

/**
 * Retrieve the Authorization header value, case-insensitive.
 *
 * @return string|null
 */
function get_authorization_header() {
    $headers = [];
    // Apache may store headers differently; getallheaders() is not always available
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
    } else {
        foreach ($_SERVER as $name => $value) {
            if (substr($name, 0, 5) == 'HTTP_') {
                $headerName = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))));
                $headers[$headerName] = $value;
            }
        }
    }
    foreach ($headers as $key => $val) {
        if (strcasecmp($key, 'Authorization') === 0) {
            return $val;
        }
    }
    return null;
}

/**
 * Get the authenticated user payload from the JWT in the Authorization header.
 * Returns null if no token is present or verification fails.
 *
 * @return array|null
 */
function get_authenticated_user() {
    // When using sessions, simply read the user info from the session.
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    if (!empty($_SESSION['user'])) {
        return $_SESSION['user'];
    }
    return null;
}