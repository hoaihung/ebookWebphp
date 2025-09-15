<?php
// File: api/reorder_handler.php
//
// Safe, atomic chapter reordering to avoid UNIQUE(book_id, chapter_number) collisions
// and keep chapter numbers in content JSON in sync.
//
// Usage from api/index.php route:
//   require __DIR__ . '/reorder_handler.php';
//   handle_reorder($db, (int)$m['bid']);
//
// Expects JSON body: { "items": [ { "id": 123, "chapter_number": 1 }, { "id": 456, "chapter_number": 2 }, ... ] }
// (order in array defines the final order; if chapter_number is omitted it will be derived from array position starting at 1).

require_once __DIR__ . '/toc_utils.php';

if (!function_exists('handle_reorder')) {
    function handle_reorder(PDO $db, int $bookId): void {
        header('Content-Type: application/json; charset=utf-8');

        $raw = file_get_contents('php://input');
        $payload = json_decode($raw, true);
        if (!is_array($payload) || !isset($payload['items']) || !is_array($payload['items'])) {
            http_response_code(400);
            echo json_encode([ 'message' => 'Bad request: items required' ]);
            return;
        }

        // Build final order map id => final_number starting from 1 in array order
        $finalOrder = [];
        $pos = 1;
        foreach ($payload['items'] as $it) {
            if (is_array($it) && isset($it['id'])) {
                $id = (int)$it['id'];
                // If client supplies chapter_number explicitly, respect it; otherwise compute from position
                if (isset($it['chapter_number']) && $it['chapter_number'] !== '') {
                    $finalOrder[$id] = (int)$it['chapter_number'];
                } else {
                    $finalOrder[$id] = $pos;
                }
                $pos++;
            } elseif (is_numeric($it)) {
                $finalOrder[(int)$it] = $pos++;
            }
        }
        if (empty($finalOrder)) {
            http_response_code(400);
            echo json_encode([ 'message' => 'Bad request: items empty' ]);
            return;
        }

        try {
            $db->beginTransaction();

            // Lock rows of this book to prevent concurrent changes
            $stmt = $db->prepare('SELECT id, chapter_number, content FROM chapters WHERE book_id = ? ORDER BY chapter_number FOR UPDATE');
            $stmt->execute([$bookId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            if (!$rows) {
                throw new RuntimeException('No chapters found for given book');
            }

            // Append any missing ids not in payload to end (preserve existing order) 
            $existingIds = array_map(fn($r) => (int)$r['id'], $rows);
            foreach ($existingIds as $id) {
                if (!isset($finalOrder[$id])) {
                    $finalOrder[$id] = $pos++;
                }
            }

            // Phase A: bump numbers out of the way to avoid UNIQUE(book_id, chapter_number) collisions
            $db->prepare('UPDATE chapters SET chapter_number = chapter_number + 10000 WHERE book_id = ?')->execute([$bookId]);

            // Phase B: write final chapter_number and sync content JSON
            $upd = $db->prepare('UPDATE chapters SET chapter_number = ?, content = ? WHERE id = ? AND book_id = ?');
            foreach ($rows as $r) {
                $id = (int)$r['id'];
                $num = (int)$finalOrder[$id];
                $json = $r['content'];
                $contentArr = json_decode($json, true);
                if (!is_array($contentArr)) {
                    $contentArr = [];
                }
                // Standardize chapter number fields
                $contentArr['chapter_number'] = $num;
                $contentArr['chapterNumber'] = $num;
                if (!isset($contentArr['meta']) || !is_array($contentArr['meta'])) {
                    $contentArr['meta'] = [];
                }
                $contentArr['meta']['chapter_number'] = $num;
                $contentArr['meta']['chapterNumber'] = $num;
                $contentArr['meta']['chapter_id'] = $id;
                $upd->execute([
                    $num,
                    json_encode($contentArr, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),
                    $id,
                    $bookId
                ]);
            }

            // Đồng bộ TOC theo thứ tự mới
            rebuild_toc_hard($db, $bookId);

            $db->commit();
            // respond with final order mapping
            $respItems = [];
            foreach ($finalOrder as $id => $num) {
                $respItems[] = [ 'id' => $id, 'chapter_number' => $num ];
            }
            echo json_encode([ 'message' => 'Đã lưu thứ tự chương', 'items' => $respItems ]);
        } catch (Throwable $ex) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            http_response_code(500);
            echo json_encode([ 'message' => 'Lỗi cập nhật thứ tự chương', 'detail' => $ex->getMessage() ]);
        }
    }
}