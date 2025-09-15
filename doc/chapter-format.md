# Định dạng nội dung chương cho EbookLib

Hệ thống **EbookLib** hỗ trợ hai cách lưu nội dung chương:

1. **Dạng JSON (legacy)** – dành cho những sách hiện tại sử dụng cấu trúc template cũ. Trường `chapters.content` trong cơ sở dữ liệu lưu toàn bộ JSON của chương. Khi import sách từ thư mục, hệ thống sẽ đọc file JSON này và lưu vào DB.

2. **Dạng Markdown (khuyến nghị)** – để soạn thảo nội dung nhanh và dễ đọc. Admin nhập nội dung bằng cú pháp Markdown mở rộng. Khi lưu, nội dung Markdown sẽ được chuyển thành HTML và (trong tương lai) lưu vào cột `chapters.render_html`. Hiện tại, bạn vẫn có thể sử dụng JSON như cấu trúc cũ.

## 1. Cấu trúc JSON cho chương (legacy)

Một file chương dạng JSON bao gồm các khối (block) với loại và nội dung khác nhau. Ví dụ:

```json
{
  "chapterTitle": "Tiêu đề chương",
  "blocks": [
    { "type": "subheading", "text": "Tiêu đề nhỏ" },
    { "type": "paragraph", "text": "Một đoạn văn có **định dạng đậm** và *nghiêng*." },
    { "type": "quote", "text": "Nội dung trích dẫn", "author": "Tên tác giả" },
    { "type": "alert", "level": "info", "text": "Nội dung ghi chú" },
    {
      "type": "questionList",
      "title": "Các câu hỏi",
      "items": ["Câu hỏi 1", "Câu hỏi 2"]
    }
    // … và các block khác tuỳ theo template
  ]
}
```

Trong đó:

- `type`: loại block (`subheading`, `paragraph`, `quote`, `alert`, `questionList`, `analogy`, `roleDescription`, `learningObjectives`, …).
- `text`: nội dung văn bản (hỗ trợ **đậm**, *nghiêng*, [liên kết](#)).
- `level` (đối với `alert`): `info`, `warning`, `success`, …
- `items`: danh sách mục con (đối với `questionList` hoặc `list`).

Bạn có thể tiếp tục sử dụng cấu trúc này cho các ebook hiện có. Khi import, hệ thống sẽ lưu nguyên JSON vào `chapters.content`.

## 2. Định dạng Markdown (khuyến nghị)

Để thuận tiện hơn cho việc soạn thảo và mở rộng cho nhiều dạng ebook, EbookLib khuyến khích sử dụng cú pháp **Markdown** đơn giản với một vài mở rộng:

- **Tiêu đề**: `#`, `##`, `###` …
- **Định dạng chữ**: `**đậm**`, `*nghiêng*`, `` `code` ``.
- **Danh sách**: `- Mục 1`, `1. Mục 1`.
- **Trích dẫn**: dòng bắt đầu với `>`.
- **Ghi chú (callout)**:
  ```
  :::info
  Nội dung ghi chú dạng info
  :::
  ```
  Các mức có thể dùng: `info`, `warn`, `success`.
- **Hình ảnh**: `![alt text](url)`.
- **Liên kết**: `[văn bản](địa chỉ)`. 

Trong tương lai gần, khi lưu chương ở định dạng Markdown, hệ thống sẽ tự động sinh `toc_json` từ các tiêu đề (H1–H3) và chuyển Markdown thành HTML để hiển thị. Tính năng này đang trong quá trình triển khai. Hiện tại, bạn vẫn cần import sách với JSON như trước.

## 3. Nhập sách

Khi thêm sách mới hoặc import bằng trang quản trị, admin chỉ cần cung cấp:

* **`toc.json`** – chứa cấu trúc chương và tiêu đề.
* Các file chương tương ứng – có thể là file JSON (theo cấu trúc legacy) hoặc file `.md` (nếu áp dụng Markdown trong tương lai).

Hệ thống sẽ đọc toàn bộ nội dung và lưu vào cơ sở dữ liệu. Nếu bạn đang import sách từ Supabase hoặc hệ thống cũ, hãy giữ nguyên cấu trúc thư mục và tệp như cũ để việc nhập liệu diễn ra thuận lợi.