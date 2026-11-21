-- ============================================================================
-- EduShelf Inventory Management System
-- Relational MySQL schema + idempotent seed data
--
-- Run with:
--   mysql -u root -p < schema.sql
--
-- The script is safe to re-run: it never drops tables or user data, and the
-- seed statements use INSERT ... ON DUPLICATE KEY UPDATE.
-- ============================================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS edushelf_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE edushelf_db;

-- ----------------------------------------------------------------------------
-- Master inventory catalog
-- Table name intentionally matches cell A1 of the source datasheet.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventoryStock (
  product_code VARCHAR(20) NOT NULL,
  product_name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  location VARCHAR(50) NOT NULL,
  threshold INT NOT NULL DEFAULT 5,
  status ENUM('With Stock', 'Low Stock', 'Out of Stock') NOT NULL DEFAULT 'With Stock',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_code),
  KEY idx_items_category (category),
  KEY idx_items_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Application accounts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('Administrator', 'Warehouse Staff') NOT NULL DEFAULT 'Warehouse Staff',
  failed_attempts INT NOT NULL DEFAULT 0,
  is_locked TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Supply requests raised by staff and reviewed by administrators
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_requests (
  request_id INT AUTO_INCREMENT PRIMARY KEY,
  product_code VARCHAR(20) NOT NULL,
  user_id INT NOT NULL,
  quantity_requested INT NOT NULL,
  purpose VARCHAR(255) NOT NULL,
  status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
  reviewed_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_requests_status (status),
  KEY idx_requests_created_at (created_at),
  CONSTRAINT fk_requests_product
    FOREIGN KEY (product_code) REFERENCES inventoryStock (product_code)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_requests_user
    FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_requests_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users (user_id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Append-only activity trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  product_code VARCHAR(20) NULL,
  action VARCHAR(100) NOT NULL,
  details TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_logs_action (action),
  KEY idx_logs_created_at (created_at),
  CONSTRAINT fk_logs_user
    FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_logs_product
    FOREIGN KEY (product_code) REFERENCES inventoryStock (product_code)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Seed inventory (11 rows from the datasheet)
-- Thresholds are derived so that each row satisfies the status invariant.
-- ----------------------------------------------------------------------------
INSERT INTO inventoryStock
  (product_code, product_name, category, quantity, unit_price, location, threshold, status)
VALUES
  ('BP-BLK-001', 'Ballpen (Black)', 'Writing Tool', 150, 10.00, 'Shelf A1', 15, 'With Stock'),
  ('BP-RED-002', 'Ballpen (Red)', 'Writing Tool', 8, 12.50, 'Shelf A1', 10, 'Low Stock'),
  ('YP-STD-003', 'Yellow Pad (100 sheets)', 'Stationery', 45, 78.50, 'Shelf B2', 10, 'With Stock'),
  ('BP-LNG-004', 'Bond Paper (Long, Ream)', 'Stationery', 20, 240.00, 'Shelf B3', 5, 'With Stock'),
  ('BP-SHT-005', 'Bond Paper (Short, Ream)', 'Stationery', 3, 210.00, 'Shelf B3', 5, 'Low Stock'),
  ('MRK-PER-006', 'Permanent Marker (Black)', 'Writing Tool', 0, 35.00, 'Shelf A2', 10, 'Out of Stock'),
  ('MRK-WBO-007', 'White Board Marker (Blue)', 'Writing Tool', 30, 38.00, 'Shelf A2', 10, 'With Stock'),
  ('INK-BLK-008', 'Printer Ink (Black, 70ml)', 'Printer Supplies', 12, 350.00, 'Cabinet C1', 5, 'With Stock'),
  ('INK-CYN-0009', 'Printer Ink (Cyan, 70ml)', 'Printer Supplies', 4, 350.00, 'Cabinet C1', 5, 'Low Stock'),
  ('INK-YLW-010', 'Printer Ink (Yellow, 70ml)', 'Printer Supplies', 0, 350.00, 'Cabinet C1', 5, 'Out of Stock'),
  ('INK-MAG-011', 'Printer Ink (Magenta, 70ml)', 'Printer Supplies', 10, 350.00, 'Cabinet C1', 5, 'With Stock')
ON DUPLICATE KEY UPDATE
  product_name = VALUES(product_name),
  category = VALUES(category),
  quantity = VALUES(quantity),
  unit_price = VALUES(unit_price),
  location = VALUES(location),
  threshold = VALUES(threshold),
  status = VALUES(status);

-- ----------------------------------------------------------------------------
-- Demo accounts
-- Passwords: Admin@1234 / Staff@1234
-- Rerunning this script restores the demo credentials and unlocks the accounts.
-- ----------------------------------------------------------------------------
INSERT INTO users
  (full_name, email, password_hash, role, failed_attempts, is_locked)
VALUES
  (
    'Juan Dela Cruz',
    'admin@edushelf.edu.ph',
    'scrypt:32768:8:1$wRs7M9Urbejepwbr$e380747d31bd439b2c39aca7d28160b529d40190645f5c7810586c463eab85ee2e9f474a4cd922eea0de4b5acc714458d2b115d25b705ee54f97dbd2506b057b',
    'Administrator',
    0,
    0
  ),
  (
    'Maria Santos',
    'staff@edushelf.edu.ph',
    'scrypt:32768:8:1$fXeO2iTQx1jUDnAs$21cb31e4d81b159e4058b8328829cf8dcfb683ed3aef98fbcfe7b09584255a7f63c029ae9df4f28ea89bcda59f19cc4166cd4801ec11e37f68ad8c98f74aded3',
    'Warehouse Staff',
    0,
    0
  )
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  role = VALUES(role),
  password_hash = VALUES(password_hash),
  failed_attempts = 0,
  is_locked = 0;

-- ----------------------------------------------------------------------------
-- Opening audit records (idempotent: one per product code)
-- ----------------------------------------------------------------------------
INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'BP-BLK-001', 'Initial Record', 'Opening stock recorded at 150 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'BP-BLK-001' AND action = 'Initial Record'
);

INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'BP-RED-002', 'Initial Record', 'Opening stock recorded at 8 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'BP-RED-002' AND action = 'Initial Record'
);

INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'YP-STD-003', 'Initial Record', 'Opening stock recorded at 45 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'YP-STD-003' AND action = 'Initial Record'
);

INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'BP-LNG-004', 'Initial Record', 'Opening stock recorded at 20 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'BP-LNG-004' AND action = 'Initial Record'
);

INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'BP-SHT-005', 'Initial Record', 'Opening stock recorded at 3 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'BP-SHT-005' AND action = 'Initial Record'
);

INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'MRK-PER-006', 'Initial Record', 'Opening stock recorded at 0 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'MRK-PER-006' AND action = 'Initial Record'
);

INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'MRK-WBO-007', 'Initial Record', 'Opening stock recorded at 30 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'MRK-WBO-007' AND action = 'Initial Record'
);

INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'INK-BLK-008', 'Initial Record', 'Opening stock recorded at 12 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'INK-BLK-008' AND action = 'Initial Record'
);

INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'INK-CYN-0009', 'Initial Record', 'Opening stock recorded at 4 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'INK-CYN-0009' AND action = 'Initial Record'
);

INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'INK-YLW-010', 'Initial Record', 'Opening stock recorded at 0 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'INK-YLW-010' AND action = 'Initial Record'
);

INSERT INTO audit_logs (user_id, product_code, action, details)
SELECT NULL, 'INK-MAG-011', 'Initial Record', 'Opening stock recorded at 10 units'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs
  WHERE product_code = 'INK-MAG-011' AND action = 'Initial Record'
);
