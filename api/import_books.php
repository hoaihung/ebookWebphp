<?php
// CLI script to import or update a book from a JSON folder into MySQL.
// This script should be run from the command line:
//   php import_books.php --folder=sample-book/InsightToMoney [--book-id=1] [--access-level=paid] [--published]

require_once __DIR__ . '/db.php';

function usage() {
    echo "Usage: php import_books.php --folder=<path> [--book-id=<id>] [--access-level=free|paid] [--published]\n";
    exit(1);
}

// Parse CLI options
$opts = getopt("", [
    "folder:",
    "book-id::",
    "access-level::",
    "published::",
]);

if (!isset($opts['folder'])) {
    usage();
}

$folder = $opts['folder'];
$bookId = isset($opts['book-id']) ? (int)$opts['book-id'] : null;
$accessLevel = isset($opts['access-level']) ? $opts['access-level'] : 'free';
$isPublished = array_key_exists('published', $opts);

$projectRoot = realpath(__DIR__ . '/..');
$folderPath = realpath($projectRoot . '/' . $folder);
if (!$folderPath || !is_dir($folderPath)) {
    fwrite(STDERR, "Folder not found: {$folder}\n");
    exit(1);
}

$tocFile = $folderPath . '/toc.json';
if (!file_exists($tocFile)) {
    fwrite(STDERR, "toc.json not found in {$folder}\n");
    exit(1);
}

$tocContent = file_get_contents($tocFile);
$toc = json_decode($tocContent, true);
if (!$toc) {
    fwrite(STDERR, "Failed to parse toc.json\n");
    exit(1);
}

$title = isset($toc['ebookTitle']) ? $toc['ebookTitle'] : basename($folderPath);
$templatePath = '/assets/templates/default-ebook-template.html';

// Attempt to guess cover image
$cover = null;
$imagesDir = $projectRoot . '/assets/images/book';
if (is_dir($imagesDir)) {
    $baseName = strtolower(basename($folderPath));
    $files = scandir($imagesDir);
    foreach ($files as $file) {
        if (preg_match('/^' . preg_quote($baseName, '/') . '\./i', $file)) {
            $cover = '/assets/images/book/' . $file;
            break;
        }
    }
}

try {
    $db = get_db();
    $db->beginTransaction();
    // Insert or update book
    $tocRelative = trim(str_replace($projectRoot . '/sample-book/', '', $tocFile), '/');
    $tocJson = json_encode($toc);
    if ($bookId) {
        // Update existing book
        $stmt = $db->prepare('UPDATE books SET title=?, toc_path=?, template_path=?, access_level=?, is_published=?, toc_json=?, cover_image_url=IFNULL(?, cover_image_url) WHERE id=?');
        $stmt->execute([$title, $tocRelative, $templatePath, $accessLevel, $isPublished ? 1 : 0, $tocJson, $cover, $bookId]);
        $newBookId = $bookId;
    } else {
        $stmt = $db->prepare('INSERT INTO books (title, toc_path, template_path, access_level, is_published, toc_json, cover_image_url) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$title, $tocRelative, $templatePath, $accessLevel, $isPublished ? 1 : 0, $tocJson, $cover]);
        $newBookId = $db->lastInsertId();
    }
    // Delete existing chapters
    $stmt = $db->prepare('DELETE FROM chapters WHERE book_id = ?');
    $stmt->execute([$newBookId]);
    // Insert chapters
    $totalChapters = 0;
    foreach ($toc['phases'] as $phase) {
        foreach ($phase['chapters'] as $chapter) {
            $chapterNumber = (int)$chapter['chapterNumber'];
            $chapterTitle = $chapter['chapterTitle'];
            $type = isset($chapter['type']) ? $chapter['type'] : null;
            $week = isset($chapter['week']) ? (int)$chapter['week'] : null;
            $chapterFile = $folderPath . '/' . $chapter['jsonFile'];
            if (!file_exists($chapterFile)) {
                fwrite(STDERR, "Chapter file not found: {$chapter['jsonFile']}\n");
                continue;
            }
            $chapterData = file_get_contents($chapterFile);
            $chapterJson = json_decode($chapterData, true);
            if (!$chapterJson) {
                fwrite(STDERR, "Failed to parse chapter: {$chapter['jsonFile']}\n");
                continue;
            }
            $stmt = $db->prepare('INSERT INTO chapters (book_id, chapter_number, title, type, week, content) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$newBookId, $chapterNumber, $chapterTitle, $type, $week, json_encode($chapterJson)]);
            $totalChapters++;
        }
    }
    $db->commit();
    echo "Đã nhập {$totalChapters} chương cho sách \"{$title}\" (ID: {$newBookId})\n";
} catch (Exception $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    fwrite(STDERR, "Import failed: " . $e->getMessage() . "\n");
    exit(1);
}