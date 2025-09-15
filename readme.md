# EbookWeb2 (PHP) – Ứng dụng đọc ebook với PHP & MySQL

Phiên bản này chuyển đổi hoàn toàn backend từ Node.js sang **PHP thuần** sử dụng **MySQL**. Toàn bộ tính năng đăng ký, đăng nhập, quản lý sách/gói và đọc sách đều được giữ nguyên. Ngoài ra còn hỗ trợ lưu nội dung sách trong cơ sở dữ liệu (bảng `chapters`) và công cụ nhập sách từ thư mục JSON.

## 1. Chuẩn bị môi trường

1. **MySQL**: cài đặt MySQL và tạo một cơ sở dữ liệu (ví dụ `ebooklib`).
2. **PHP**: cài đặt PHP 8.0 trở lên. Có thể chạy bằng web server (Apache/Nginx) hoặc server built‑in `php -S`.
3. **Tải mã nguồn**: giải nén gói `ebookweb2_php` vào thư mục làm việc.

## 2. Tạo cấu trúc cơ sở dữ liệu

Chạy file `schema.sql` trong MySQL để tạo bảng. Ví dụ:

```sh
mysql -u root -p ebooklib < schema.sql
```

Các bảng `users`, `books`, `packages`, `user_book_access`, `user_packages`, `user_reading_progress` và `chapters` sẽ được tạo. Bạn có thể xem thêm mô tả trong `schema.sql`.

## 3. Cấu hình ứng dụng

Ứng dụng đọc các biến môi trường để kết nối DB. Tạo file `.env` (hoặc thiết lập biến môi trường hệ thống) với nội dung:

```ini
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_user
DB_PASSWORD=your_password
DB_DATABASE=ebooklib
```

Khi chạy bằng web server, bạn có thể thiết lập biến môi trường trong cấu hình server hoặc dùng thư viện như `dotenv`. Đối với server built‑in, bạn có thể chạy:

```sh
export DB_HOST=localhost
export DB_PORT=3306
export DB_USER=your_user
export DB_PASSWORD=your_password
export DB_DATABASE=ebooklib
php -S localhost:3000 -t . api/index.php
```

Lệnh trên sử dụng PHP built‑in server, chuyển tất cả request dưới `/api` tới `api/index.php`. Bạn nên cài đặt rewrite rules tương tự trên Apache/Nginx để ánh xạ mọi URL `/api/*` tới `api/index.php`.

## 4. Sử dụng API

Các API giữ nguyên đường dẫn so với bản Node, nhưng cơ chế xác thực đã được chuyển sang **PHP session**. Khi gọi API từ frontend, bạn cần cho phép **cookies** (sử dụng `credentials: 'include'` khi gọi `fetch()`). Dưới đây là danh sách các endpoint quan trọng:

- `POST /api/register` – đăng ký (body: `{ email, password }`). Trả về `{ user }` và tự động đăng nhập người dùng bằng session.
- `POST /api/login` – đăng nhập (body: `{ email, password }`). Trả về `{ user }` và thiết lập session.
- `POST /api/logout` – đăng xuất, hủy session.
- `GET /api/session` – trả về `{ user: {...} }` nếu đang đăng nhập, hoặc `{ user: null }` nếu chưa.
- `GET /api/books` – danh sách sách đã xuất bản, có thể thêm `?search=keyword`.
- `GET /api/books/{id}` – chi tiết một sách.
- `GET /api/packages/{id}` – chi tiết gói.
- `GET /api/user/books` – sách người dùng sở hữu (yêu cầu đăng nhập).
- `GET /api/user/packages` – gói người dùng sở hữu (yêu cầu đăng nhập).
- `GET /api/toc/{bookId}` – mục lục; yêu cầu quyền truy cập nếu sách trả phí. Dữ liệu được lấy hoàn toàn từ cột `toc_json` trong DB.
- `GET /api/chapter?book_id=ID&chapter=N` – nội dung chương; đọc từ bảng `chapters`. Nếu chương chưa được nhập, trả về lỗi 404.

Do sử dụng session, **không còn JWT** và cũng không cần gửi header `Authorization`.

## 5. Nhập sách từ thư mục JSON

Script `api/import_books.php` cho phép nhập hoặc cập nhật sách từ thư mục chứa `toc.json` và các file chương. Cách sử dụng:

```sh
php api/import_books.php --folder=sample-book/InsightToMoney --access-level=paid --published
```

Tham số:

- `--folder`: đường dẫn tương đối tới thư mục sách (bên trong thư mục dự án).
- `--book-id`: (tuỳ chọn) ID sách cần cập nhật.
- `--access-level`: `free` hoặc `paid` (mặc định `free`).
- `--published`: nếu có tham số này sẽ đánh dấu sách được xuất bản.

Script tự động đọc `toc.json`, tìm ảnh bìa trong `assets/images/book`, cập nhật bảng `books` (bao gồm cột `toc_json`) và chèn các chương vào bảng `chapters`. Sau khi chạy script, nội dung sách được lưu **toàn bộ trong cơ sở dữ liệu** và người dùng đọc trực tiếp từ DB. Trong môi trường production, bạn nên xây dựng trang quản trị để thực thi script này hoặc cung cấp UI cho admin upload thư mục chương.

## 6. Phân quyền và vai trò

- **Vai trò người dùng (`users.role`)**: hiện có hai role mặc định là `user` và `admin`. Bạn có thể mở rộng thêm bảng `roles` và bảng liên kết `user_roles` nếu muốn hỗ trợ nhiều quyền tùy biến (ví dụ `editor`, `moderator`).
- **Vai trò sách (`books.access_level`)**: xác định sách miễn phí (`free`) hay trả phí (`paid`). Bạn có thể mở rộng bằng cách thêm các giá trị mới như `premium`, `vip` trong cột này hoặc tạo bảng riêng `book_access_levels` để linh hoạt hơn.
- **Vai trò gói (`packages.access_type`)**: ví dụ `lifetime_all_access` để cấp quyền xem tất cả sách. Bạn có thể bổ sung các loại gói khác (theo tháng, theo năm) và map tới quyền truy cập sách.
- Người dùng mua sách lẻ được lưu trong bảng `user_book_access`.
- Người dùng sở hữu gói được lưu trong bảng `user_packages`. Nếu gói có `access_type = 'lifetime_all_access'`, họ có thể truy cập tất cả sách trả phí.
- Phần frontend đã được điều chỉnh để làm việc với API PHP; `config.js` đặt `API_BASE` là `/api`.

## 7. Khuyến nghị

- Cài đặt rewrite (mod_rewrite trên Apache hoặc try_files trên Nginx) để mọi URL dưới `/api` đều chuyển đến `api/index.php`.
- Khi triển khai thật, hãy bật HTTPS và cấu hình CORS chỉ cho phép domain của frontend.
- Để cải thiện hiệu năng, bạn có thể thêm chỉ mục cho các trường `book_id`, `user_id` trong bảng liên quan và thêm cache cho mục lục/chương.

---

Hệ thống này mang lại sự linh hoạt: có thể đọc sách trực tiếp từ JSON (dễ dàng upload) hoặc nhập toàn bộ nội dung vào DB để phục vụ đồng thời nhiều người dùng.