// server/index.js
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');
const routes  = require('./routes');
const { sendEmail } = require('./emailService');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Load DB settings into process.env on startup ──────────────────────────────
(function loadDbSettings() {
  try {
    const saved = db.getAllSettings();
    for (const [key, val] of Object.entries(saved)) {
      if (val && !process.env[key]) process.env[key] = val;
    }
  } catch (_) {}
})();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', routes);
app.use('/',    routes);

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.stack || err.message);
  res.status(500).json({ success: false, error: err.message });
});

// ── Scheduled send worker ─────────────────────────────────────────────────────
function runScheduledWorker() {
  try {
    const due = db.getDueScheduled();
    if (!due.length) return;
    console.log(`[Scheduler] Processing ${due.length} scheduled message(s)…`);
    for (const msg of due) {
      const viewUrl = `${process.env.APP_URL || 'http://localhost:' + PORT}/view/${msg.view_token}`;
      sendEmail({ ...msg, viewUrl })
        .then(() => { db.markSent(msg.id); console.log(`[Scheduler] ✓ Sent to ${msg.to_name}`); })
        .catch(e  => { db.markFailed(e.message, msg.id); console.error(`[Scheduler] ✗ ${e.message}`); });
    }
  } catch (e) {
    console.error('[Scheduler] Error:', e.message);
  }
}

// ── Start — listen ONCE ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ┌──────────────────────────────────────────────────┐
  │           The Editorial Muse — Server            │
  │                                                  │
  │  App:     http://localhost:${PORT}                    │
  │  API:     http://localhost:${PORT}/api/messages       │
  │  Health:  http://localhost:${PORT}/health             │
  └──────────────────────────────────────────────────┘
  `);
  setInterval(runScheduledWorker, 60 * 1000);
  runScheduledWorker();
});

module.exports = app;
