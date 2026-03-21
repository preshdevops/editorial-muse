// server/index.js
try { require('dotenv').config(); } catch(_) {}

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');
const routes  = require('./routes');
const { sendEmail }    = require('./emailService');
const { sendWhatsApp } = require('./whatsappService');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Load any settings saved in the DB into process.env ────────────────────────
// (DB settings override .env so users can reconfigure without editing files)
(function loadDbSettings() {
  try {
    const saved = db.getAllSettings();
    for (const [key, val] of Object.entries(saved)) {
      if (val && !process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch (_) { /* DB may not exist yet on first boot */ }
})();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all requests (simple dev logger)
app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API + View routes ─────────────────────────────────────────────────────────
app.use('/api', routes);   // /api/messages, /api/send, /api/stats, /api/settings
app.use('/',    routes);   // /view/:token

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Error]', err.stack || err.message);
  res.status(500).json({ success: false, error: err.message });
});

// ── Scheduled Send Worker ─────────────────────────────────────────────────────
// Runs every 60 seconds, finds messages past their scheduled_at time, and sends them
function runScheduledWorker() {
  const due = db.getDueScheduled();
  if (due.length === 0) return;

  console.log(`[Scheduler] Processing ${due.length} scheduled message(s)…`);

  for (const msg of due) {
    const viewUrl = `${process.env.APP_URL || 'http://localhost:' + PORT}/view/${msg.view_token}`;

    const deliverFn = msg.channel === 'email'
      ? sendEmail({ ...msg, viewUrl })
      : sendWhatsApp({ ...msg, viewUrl });

    deliverFn
      .then(() => {
        db.markSent(msg.id);
        console.log(`[Scheduler] ✓ Sent "${msg.to_name}" via ${msg.channel}`);
      })
      .catch(err => {
        db.markFailed(err.message, msg.id);
        console.error(`[Scheduler] ✗ Failed "${msg.to_name}": ${err.message}`);
      });
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(3000, '127.0.0.1', () => {
  console.log(`
  ┌─────────────────────────────────────────────────┐
  │          The Editorial Muse — Server            │
  │                                                 │
  │  App:      http://localhost:${PORT}                   │
  │  API:      http://localhost:${PORT}/api/messages      │
  │  Stats:    http://localhost:${PORT}/api/stats         │
  │  Settings: http://localhost:${PORT}/api/settings      │
  └─────────────────────────────────────────────────┘
  `);

  // Start the scheduled send worker (polls every 60s)
  setInterval(runScheduledWorker, 60 * 1000);
  runScheduledWorker(); // also run once on startup
});

module.exports = app;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API + View routes ─────────────────────────────────────────────────────────
app.use('/api',  routes);   // /api/messages, /api/send, /api/stats
app.use('/',     routes);   // /view/:token

// ── SPA fallback — send index.html for any unmatched route ───────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ success: false, error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │       The Editorial Muse — Server       │
  │  http://localhost:${PORT}                    │
  │                                         │
  │  API:     /api/messages                 │
  │  Stats:   /api/stats                    │
  │  Letters: /view/:token                  │
  └─────────────────────────────────────────┘
  `);
});

module.exports = app;
