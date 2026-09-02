const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'letters.db');
require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS letters (
    id TEXT PRIMARY KEY,
    mood TEXT NOT NULL,
    body TEXT NOT NULL,
    reply TEXT,
    owner_token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_letters_mood ON letters(mood);
  CREATE INDEX IF NOT EXISTS idx_letters_created_at ON letters(created_at);
`);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function newOwnerToken() {
  return crypto.randomBytes(24).toString('hex');
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO letters (id, mood, body, reply, owner_token_hash, created_at)
    VALUES (@id, @mood, @body, @reply, @owner_token_hash, @created_at)
  `),
  listAll: db.prepare(`SELECT id, mood, body, reply, created_at FROM letters ORDER BY created_at DESC LIMIT ?`),
  listByMood: db.prepare(`SELECT id, mood, body, reply, created_at FROM letters WHERE mood = ? ORDER BY created_at DESC LIMIT ?`),
  search: db.prepare(`SELECT id, mood, body, reply, created_at FROM letters WHERE body LIKE ? ORDER BY created_at DESC LIMIT ?`),
  searchByMood: db.prepare(`SELECT id, mood, body, reply, created_at FROM letters WHERE mood = ? AND body LIKE ? ORDER BY created_at DESC LIMIT ?`),
  getOwnerHash: db.prepare(`SELECT owner_token_hash FROM letters WHERE id = ?`),
  deleteById: db.prepare(`DELETE FROM letters WHERE id = ?`),
  count: db.prepare(`SELECT COUNT(*) as c FROM letters`),
};

module.exports = { db, stmts, hashToken, newId, newOwnerToken };
