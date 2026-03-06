PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL,
  cash_detected REAL,
  card_detected REAL,
  total_detected REAL,
  cash_confirmed REAL NOT NULL CHECK (cash_confirmed >= 0),
  card_confirmed REAL NOT NULL CHECK (card_confirmed >= 0),
  total_confirmed REAL NOT NULL CHECK (total_confirmed >= 0),
  notes TEXT,
  image_filename TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reports_work_date
ON reports(work_date DESC);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commission_percent REAL NOT NULL DEFAULT 10 CHECK (commission_percent > 0)
);

INSERT INTO settings (id, commission_percent)
SELECT 1, 10
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1);
