-- MySQL schema for EbookLib platform

-- Drop existing tables (optional). Use with caution in development.
DROP TABLE IF EXISTS user_reading_progress;
DROP TABLE IF EXISTS user_packages;
DROP TABLE IF EXISTS user_book_access;
DROP TABLE IF EXISTS chapters;
DROP TABLE IF EXISTS packages;
DROP TABLE IF EXISTS books;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS user_notifications;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS roles;

-- Users table
CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  -- Basic role for backward compatibility. For flexible role management see roles/user_roles tables below
  role ENUM('user','admin') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Books metadata. The toc_path points to a JSON file in the sample-book directory.
CREATE TABLE books (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  description TEXT,
  cover_image_url TEXT,
  -- Path to original toc.json on disk (for reference). Can be NULL once imported
  toc_path TEXT DEFAULT NULL,
  -- Embedded table of contents stored directly in the database as JSON
  toc_json JSON DEFAULT NULL,
  template_path TEXT NOT NULL,
  access_level ENUM('free','paid') DEFAULT 'paid',
  price DECIMAL(10,2) DEFAULT 0,
  is_published BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Packages for bundles such as lifetime access
CREATE TABLE packages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  access_type TEXT NOT NULL UNIQUE,
  total_slots INT,
  claimed_slots INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  price DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Mapping of users to individual books (i.e. purchased books)
CREATE TABLE user_book_access (
  user_id BIGINT NOT NULL,
  book_id BIGINT NOT NULL,
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, book_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- Mapping of users to packages
CREATE TABLE user_packages (
  user_id BIGINT NOT NULL,
  package_id BIGINT NOT NULL,
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, package_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
);

-- Table to record last reading progress for each book per user
CREATE TABLE user_reading_progress (
  user_id BIGINT NOT NULL,
  book_id BIGINT NOT NULL,
  last_chapter_id TEXT,
  last_scroll_position DECIMAL(5,4),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, book_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- Placeholder for chapters content (used in version 2.1). Not required for v2
CREATE TABLE chapters (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  book_id BIGINT NOT NULL,
  chapter_number INT NOT NULL,
  title TEXT,
  type TEXT,
  week INT,
  content JSON,
  UNIQUE (book_id, chapter_number),
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- Notifications table to store messages sent by admins to users. If user_id is NULL,
-- the notification is considered a broadcast and shown to all users. Each user can
-- mark a notification as read via the is_read flag.
CREATE TABLE notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link_url TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Dynamic roles table to allow creation of new user roles without altering the
-- users table. Each role can represent a permission level or category (e.g.
-- moderator, editor, author, etc.). The `user_roles` table maps users to
-- roles. Existing `users.role` column still exists for backward compatibility.
CREATE TABLE roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE user_roles (
  user_id BIGINT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- Table to mark broadcast notifications as read per-user. When a notification
-- has a NULL user_id (meaning it is a broadcast), users can mark it as read
-- individually. This table records which user has read which broadcast
-- notification. For targeted notifications (user_id not NULL), the is_read
-- flag on the notification record itself is used.
CREATE TABLE user_notifications (
  user_id BIGINT NOT NULL,
  notification_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, notification_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);