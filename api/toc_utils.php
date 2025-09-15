<?php
// api/toc_utils.php
// Rebuild TOC theo đúng cấu trúc phases[] như toc.json gốc.
// - Giữ nguyên ebookTitle, totalChapters, phases metadata (phaseId/Title/Description/Badge...)
// - Chỉ thay mảng phases[i].chapters theo thứ tự chapter_number mới từ DB.
// - Không tạo "items", không thêm "version".
// - Đảm bảo mỗi chapter có đủ: chapterNumber, chapterTitle, jsonFile, type, week
//   (chapterTitle lấy từ content json mới; jsonFile/type/week lấy theo map từ toc cũ theo số chương).

function rebuild_toc_hard(PDO $db, int $bookId): void
{
    // 1) Khóa row sách & lấy toc_json cũ
    $lock = $db->prepare('SELECT id, title, toc_json FROM books WHERE id = ? FOR UPDATE');
    $lock->execute([$bookId]);
    $book = $lock->fetch(PDO::FETCH_ASSOC);
    if (!$book) return;

    $old = [];
    if (!empty($book['toc_json'])) {
        $decoded = json_decode($book['toc_json'], true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
            $old = $decoded;
        }
    }

    // Validate shape: cần có phases[]
    if (!isset($old['phases']) || !is_array($old['phases'])) {
        // Nếu không có phases, tạo 1 phase duy nhất (fallback an toàn)
        $old['ebookTitle']    = $old['ebookTitle'] ?? ($book['title'] ?? 'Untitled');
        $old['totalChapters'] = $old['totalChapters'] ?? 0;
        $old['phases'] = [[
            'phaseId'          => 'phase_1',
            'phaseTitle'       => 'PHASE 1',
            'phaseDescription' => '',
            'badgeEarned'      => '',
            'chapters'         => []
        ]];
    }

    // 2) Chuẩn bị map từ toc cũ: theo chapterNumber -> (jsonFile, type, week, chapterTitle cũ)
    $metaByNumber = [];   // number => ['jsonFile'=>..., 'type'=>..., 'week'=>..., 'chapterTitle'=>...]
    $phaseRanges  = [];   // mỗi phase => ['min'=>..., 'max'=>..., 'count'=>N]
    foreach ($old['phases'] as $pi => $phase) {
        $min = PHP_INT_MAX; $max = 0; $count = 0;
        if (isset($phase['chapters']) && is_array($phase['chapters'])) {
            foreach ($phase['chapters'] as $ch) {
                if (!is_array($ch)) continue;
                $num  = isset($ch['chapterNumber']) ? (int)$ch['chapterNumber'] : null;
                if (!$num) continue;
                $metaByNumber[$num] = [
                    'jsonFile'     => $ch['jsonFile']    ?? null,
                    'type'         => $ch['type']        ?? null,
                    'week'         => isset($ch['week']) ? (int)$ch['week'] : null,
                    'chapterTitle' => $ch['chapterTitle'] ?? null,
                ];
                $min = min($min, $num);
                $max = max($max, $num);
                $count++;
            }
        }
        if ($count === 0) { $min = 0; $max = -1; } // phase rỗng
        $phaseRanges[$pi] = ['min'=>$min, 'max'=>$max, 'count'=>$count];
    }

    // 3) Lấy chapters mới từ DB theo ORDER BY chapter_number
    // Tự phát hiện cột content_json > content
    $contentCol = 'content';
    try {
        $ck = $db->query("SHOW COLUMNS FROM `chapters` LIKE 'content_json'");
        if ($ck && $ck->fetch(PDO::FETCH_ASSOC)) $contentCol = 'content_json';
    } catch (Throwable $e) {}

    $q = $db->prepare("SELECT id, chapter_number, `$contentCol` AS content FROM chapters WHERE book_id = ? ORDER BY chapter_number ASC");
    $q->execute([$bookId]);
    $rows = $q->fetchAll(PDO::FETCH_ASSOC);

    // Build danh sách chương mới (num asc)
    $newChapters = [];
    foreach ($rows as $r) {
        $num = (int)$r['chapter_number'];
        $content = json_decode($r['content'] ?? '[]', true);
        if (!is_array($content)) $content = [];

        // Lấy title mới ưu tiên: chapterTitle > title > meta.title > "Chương N"
        $newTitle = $content['chapterTitle']
            ?? $content['title']
            ?? ($content['meta']['title'] ?? null)
            ?? ('Chương ' . $num);

        // Lấy meta cũ theo "số chương" (để giữ jsonFile/type/week) nếu tồn tại
        $oldMeta = $metaByNumber[$num] ?? ['jsonFile'=>null,'type'=>null,'week'=>null,'chapterTitle'=>null];

        $newChapters[] = [
            'chapterNumber' => $num,
            'chapterTitle'  => $newTitle,
            'jsonFile'      => $oldMeta['jsonFile'], // giữ nguyên nếu có
            'type'          => $oldMeta['type'],
            'week'          => $oldMeta['week'],
        ];
    }

    // 4) Phân bổ chapters vào phases theo 2 chiến lược:
    //    a) Ưu tiên theo RANGE cũ (min..max) nếu phase có count>0
    //    b) Nếu số mới không khớp range (ví dụ đổi khung), fallback theo COUNT cũ (giữ số lượng chương mỗi phase)
    $assigned = array_fill(0, count($old['phases']), []);
    $unassigned = $newChapters; // sẽ bốc dần khi match theo range

    // a) Assign theo range
    foreach ($newChapters as $ch) {
        $n = (int)$ch['chapterNumber'];
        $placed = false;
        foreach ($phaseRanges as $pi => $rg) {
            if ($rg['count'] > 0 && $n >= $rg['min'] && $n <= $rg['max']) {
                $assigned[$pi][] = $ch;
                $placed = true;
                break;
            }
        }
        if ($placed) {
            // xóa khỏi unassigned
            for ($i=0; $i<count($unassigned); $i++) {
                if ($unassigned[$i]['chapterNumber'] === $n) { array_splice($unassigned, $i, 1); break; }
            }
        }
    }

    // b) Fallback theo count (nếu vẫn còn chương chưa gán)
    if (!empty($unassigned)) {
        $idx = 0;
        foreach ($phaseRanges as $pi => $rg) {
            $need = max(0, $rg['count'] - count($assigned[$pi]));
            while ($need > 0 && $idx < count($unassigned)) {
                $assigned[$pi][] = $unassigned[$idx++];
                $need--;
            }
        }
        // nếu vẫn còn dư (do phase rỗng trong cũ), dồn hết vào phase cuối
        while ($idx < count($unassigned)) {
            $assigned[count($assigned)-1][] = $unassigned[$idx++];
        }
    }

    // Sort lại chapters trong mỗi phase theo chapterNumber tăng dần
    foreach ($assigned as &$arr) {
        usort($arr, function($a, $b){ return $a['chapterNumber'] <=> $b['chapterNumber']; });
    }
    unset($arr);

    // 5) Lắp vào cấu trúc toc mới (giữ nguyên metadata phase cũ)
    $newPhases = $old['phases'];
    foreach ($newPhases as $pi => &$phase) {
        $phase['chapters'] = $assigned[$pi] ?? [];
    }
    unset($phase);

    // Update totalChapters
    $old['totalChapters'] = count($newChapters);
    $old['phases'] = $newPhases;

    // 6) Ghi lại đúng vào books.toc_json
    $upd = $db->prepare('UPDATE books SET toc_json = ? WHERE id = ?');
    $upd->execute([ json_encode($old, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES), $bookId ]);
}
