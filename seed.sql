-- Sample data for EbookLib PHP application

-- Insert a founder package if none exists. This package provides lifetime access to all paid books.
INSERT INTO packages (id, name, description, access_type, total_slots, price, is_active) VALUES
    (1, 'Gói Sáng lập', 'Gói sáng lập truy cập trọn đời vào tất cả sách trả phí.', 'lifetime_all_access', NULL, 0, 1)
    ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description), access_type=VALUES(access_type), total_slots=VALUES(total_slots), price=VALUES(price), is_active=VALUES(is_active);

-- Optionally insert an admin user if none exists
-- INSERT INTO users (id, email, password_hash, role) VALUES (1, 'admin@example.com', '$2y$10$KIX./nmUv29sD.w7Z/2eJuH5Fh5GJlRU4GlMvJ3bX8cPkFiqsFc16', 'admin')
-- ON DUPLICATE KEY UPDATE email=email;
