const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      avatar_url TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      attachment_url TEXT,
      attachment_type TEXT,
      attachment_name TEXT,
      deleted_at TEXT,
      deleted_by INTEGER,
      reply_to_message_id INTEGER,
      reply_preview_author TEXT,
      reply_preview_body TEXT,
      forwarded_from_author TEXT,
      forwarded_from_body TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS private_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      attachment_url TEXT,
      attachment_type TEXT,
      attachment_name TEXT,
      deleted_at TEXT,
      deleted_by INTEGER,
      reply_to_message_id INTEGER,
      reply_preview_author TEXT,
      reply_preview_body TEXT,
      forwarded_from_author TEXT,
      forwarded_from_body TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS hidden_messages (
      user_id INTEGER NOT NULL,
      message_type TEXT NOT NULL CHECK (message_type IN ('room', 'private')),
      message_id INTEGER NOT NULL,
      hidden_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, message_type, message_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS muted_chats (
      user_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('room', 'user')),
      target_id INTEGER NOT NULL,
      muted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, target_type, target_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO rooms (id, name, created_by) VALUES (1, 'general', NULL);
  `);

  migrateColumn('users', 'avatar_url', 'TEXT');
  migrateColumn('users', 'display_name', 'TEXT');
  migrateColumn('rooms', 'avatar_url', 'TEXT');
  migrateColumn('messages', 'attachment_url', 'TEXT');
  migrateColumn('messages', 'attachment_type', 'TEXT');
  migrateColumn('messages', 'attachment_name', 'TEXT');
  migrateColumn('messages', 'deleted_at', 'TEXT');
  migrateColumn('messages', 'deleted_by', 'INTEGER');
  migrateColumn('messages', 'reply_to_message_id', 'INTEGER');
  migrateColumn('messages', 'reply_preview_author', 'TEXT');
  migrateColumn('messages', 'reply_preview_body', 'TEXT');
  migrateColumn('messages', 'forwarded_from_author', 'TEXT');
  migrateColumn('messages', 'forwarded_from_body', 'TEXT');
  migrateColumn('private_messages', 'attachment_url', 'TEXT');
  migrateColumn('private_messages', 'attachment_type', 'TEXT');
  migrateColumn('private_messages', 'attachment_name', 'TEXT');
  migrateColumn('private_messages', 'deleted_at', 'TEXT');
  migrateColumn('private_messages', 'deleted_by', 'INTEGER');
  migrateColumn('private_messages', 'reply_to_message_id', 'INTEGER');
  migrateColumn('private_messages', 'reply_preview_author', 'TEXT');
  migrateColumn('private_messages', 'reply_preview_body', 'TEXT');
  migrateColumn('private_messages', 'forwarded_from_author', 'TEXT');
  migrateColumn('private_messages', 'forwarded_from_body', 'TEXT');
  migrateColumn('private_messages', 'read_at', 'TEXT');
  migrateColumn('room_members', 'role', "TEXT NOT NULL DEFAULT 'member'");

  const generalMigration = db.prepare("SELECT value FROM app_meta WHERE key = 'general_membership_initialized'").get();
  if (!generalMigration) {
    db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id, role) SELECT 1, id, 'admin' FROM users").run();
    db.prepare("UPDATE room_members SET role = 'admin' WHERE room_id = 1").run();
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('general_membership_initialized', '1')").run();
  }

  db.prepare(`
    INSERT OR IGNORE INTO room_members (room_id, user_id, role)
    SELECT id, created_by, 'admin'
    FROM rooms
    WHERE created_by IS NOT NULL
  `).run();
}

function migrateColumn(table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  }
}

initDb();

module.exports = { db, initDb };
