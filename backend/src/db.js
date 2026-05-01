const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

/**
 * Initialize and return the SQLite database connection.
 * Creates the data directory and tables if they don't exist.
 * 
 * @param {string} [dbPath] - Optional path for the database file. 
 *                             Defaults to ./data/expenses.db
 *                             Pass ':memory:' for in-memory (tests).
 */
function getDb(dbPath) {
  if (db) return db;

  if (!dbPath) {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    dbPath = path.join(dataDir, 'expenses.db');
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
      currency TEXT NOT NULL DEFAULT 'INR',
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      expense_id TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (expense_id) REFERENCES expenses(id)
    );
  `);

  return db;
}

/**
 * Close the database connection and reset the singleton.
 * Used primarily in tests.
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
