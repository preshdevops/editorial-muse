// server/db.js
// SQLite database — stores all messages, delivery attempts, read receipts, settings
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'muse.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id           TEXT PRIMARY KEY,
    to_name      TEXT NOT NULL,
    to_contact   TEXT NOT NULL,
    from_name    TEXT NOT NULL,
    body         TEXT NOT NULL,
    song         TEXT,
    accent       TEXT DEFAULT '#ae1417',
    font         TEXT DEFAULT 'serif',
    channel      TEXT NOT NULL,
    status       TEXT DEFAULT 'draft',
    error_msg    TEXT,
    retry_count  INTEGER DEFAULT 0,
    view_token   TEXT UNIQUE,
    viewed_at    TEXT,
    view_count   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now')),
    sent_at      TEXT,
    scheduled_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_status       ON messages(status);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at   ON messages(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_view_token   ON messages(view_token);
  CREATE INDEX IF NOT EXISTS idx_messages_scheduled_at ON messages(scheduled_at);

  -- Key/value settings store (for runtime config overrides)
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Queries ───────────────────────────────────────────────────────────────────
const stmts = {
  insert: db.prepare(`
    INSERT INTO messages
      (id, to_name, to_contact, from_name, body, song, accent, font, channel, view_token, status, scheduled_at)
    VALUES
      (@id, @to_name, @to_contact, @from_name, @body, @song, @accent, @font, @channel, @view_token, @status, @scheduled_at)
  `),

  markSent: db.prepare(`
    UPDATE messages SET status='sent', sent_at=datetime('now'), error_msg=NULL WHERE id=?
  `),

  markFailed: db.prepare(`
    UPDATE messages
    SET status='failed', error_msg=?, retry_count = retry_count + 1
    WHERE id=?
  `),

  resetToScheduled: db.prepare(`
    UPDATE messages SET status='scheduled', error_msg=NULL WHERE id=?
  `),

  // Search + filter + paginate in one query
  search: db.prepare(`
    SELECT id, to_name, to_contact, from_name, song, channel, status,
           view_count, created_at, sent_at, viewed_at, accent, retry_count, scheduled_at
    FROM messages
    WHERE
      (@status  IS NULL OR status  = @status)
      AND (@channel IS NULL OR channel = @channel)
      AND (@q     IS NULL OR (
        to_name    LIKE '%' || @q || '%' OR
        from_name  LIKE '%' || @q || '%' OR
        to_contact LIKE '%' || @q || '%'
      ))
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `),

  searchCount: db.prepare(`
    SELECT COUNT(*) as total FROM messages
    WHERE
      (@status  IS NULL OR status  = @status)
      AND (@channel IS NULL OR channel = @channel)
      AND (@q     IS NULL OR (
        to_name    LIKE '%' || @q || '%' OR
        from_name  LIKE '%' || @q || '%' OR
        to_contact LIKE '%' || @q || '%'
      ))
  `),

  getById:    db.prepare(`SELECT * FROM messages WHERE id=?`),
  getByToken: db.prepare(`SELECT * FROM messages WHERE view_token=?`),

  // Fetch all messages due for scheduled delivery
  getDueScheduled: db.prepare(`
    SELECT * FROM messages
    WHERE status='scheduled' AND scheduled_at <= datetime('now')
  `),

  recordView: db.prepare(`
    UPDATE messages
    SET view_count = view_count + 1,
        viewed_at  = CASE WHEN viewed_at IS NULL THEN datetime('now') ELSE viewed_at END,
        status     = CASE WHEN status='sent' THEN 'read' ELSE status END
    WHERE view_token=?
  `),

  delete: db.prepare(`DELETE FROM messages WHERE id=?`),

  stats: db.prepare(`
    SELECT
      COUNT(*)                                           AS total,
      SUM(CASE WHEN status='draft'     THEN 1 ELSE 0 END) AS drafts,
      SUM(CASE WHEN status='sent'      THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status='read'      THEN 1 ELSE 0 END) AS read,
      SUM(CASE WHEN status='failed'    THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) AS scheduled,
      SUM(CASE WHEN channel='email'    THEN 1 ELSE 0 END) AS via_email,
      SUM(CASE WHEN channel='whatsapp' THEN 1 ELSE 0 END) AS via_whatsapp,
      SUM(view_count)                                    AS total_views
    FROM messages
  `),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key=?`),
  setSetting: db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `),
  getAllSettings: db.prepare(`SELECT key, value FROM settings`),
};

module.exports = {
  // Messages
  insertMessage:     (data)        => stmts.insert.run(data),
  markSent:          (id)          => stmts.markSent.run(id),
  markFailed:        (msg, id)     => stmts.markFailed.run(msg, id),
  resetToScheduled:  (id)          => stmts.resetToScheduled.run(id),
  getMessageById:    (id)          => stmts.getById.get(id),
  getByToken:        (tok)         => stmts.getByToken.get(tok),
  getDueScheduled:   ()            => stmts.getDueScheduled.all(),
  recordView:        (tok)         => stmts.recordView.run(tok),
  deleteMessage:     (id)          => stmts.delete.run(id),
  getStats:          ()            => stmts.stats.get(),

  searchMessages: ({ status, channel, q, limit = 20, offset = 0 }) => {
    const params = {
      status:  status  || null,
      channel: channel || null,
      q:       q       || null,
      limit:   parseInt(limit),
      offset:  parseInt(offset),
    };
    return {
      messages: stmts.search.all(params),
      total:    stmts.searchCount.get(params).total,
    };
  },

  // Settings
  getSetting:     (key)        => { const r = stmts.getSetting.get(key); return r?.value ?? null; },
  setSetting:     (key, value) => stmts.setSetting.run(key, value),
  getAllSettings:  ()           => {
    const rows = stmts.getAllSettings.all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },
};
