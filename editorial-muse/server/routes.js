// server/routes.js
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const db       = require('./db');
const { sendEmail }     = require('./emailService');
const { sendWhatsApp }  = require('./whatsappService');

const router = express.Router();

// ── Simple in-memory rate limiter ─────────────────────────────────────────────
const rateLimiter = (() => {
  const hits = new Map(); // ip => [timestamps]
  const WINDOW_MS  = 60 * 1000; // 1 minute
  const MAX_SENDS  = 10;        // max sends per window per IP

  return (req, res, next) => {
    const ip  = req.ip || 'unknown';
    const now = Date.now();
    const ts  = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
    if (ts.length >= MAX_SENDS) {
      return res.status(429).json({ success: false, error: 'Too many requests. Please wait a minute.' });
    }
    ts.push(now);
    hits.set(ip, ts);
    next();
  };
})();

// ── Helpers ───────────────────────────────────────────────────────────────────
function ok(res, data)         { res.json({ success: true,  ...data }); }
function fail(res, msg, code)  { res.status(code || 400).json({ success: false, error: msg }); }

function validateMessage(body) {
  const { to_name, to_contact, from_name, body: text, channel } = body;
  if (!to_name?.trim())    return 'Recipient name is required';
  if (!to_contact?.trim()) return 'Recipient contact is required';
  if (!from_name?.trim())  return 'Sender name is required';
  if (!text?.trim())       return 'Message body is required';
  if (!['email','whatsapp'].includes(channel)) return 'Channel must be "email" or "whatsapp"';
  if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to_contact)) {
    return 'Invalid email address';
  }
  return null;
}

function buildViewUrl(view_token) {
  const base = process.env.APP_URL || 'http://localhost:3000';
  return `${base}/view/${view_token}`;
}

// ── GET /api/messages — list with search, filter, pagination ─────────────────
// Query params: ?status=sent|read|failed|draft|scheduled
//               &channel=email|whatsapp
//               &q=search term
//               &page=1&limit=20
router.get('/messages', (req, res) => {
  try {
    const { status, channel, q } = req.query;
    const limit  = Math.min(parseInt(req.query.limit  || 20), 100);
    const page   = Math.max(parseInt(req.query.page   || 1), 1);
    const offset = (page - 1) * limit;

    const { messages, total } = db.searchMessages({ status, channel, q, limit, offset });

    ok(res, {
      messages,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── GET /api/messages/:id ─────────────────────────────────────────────────────
router.get('/messages/:id', (req, res) => {
  try {
    const msg = db.getMessageById(req.params.id);
    if (!msg) return fail(res, 'Message not found', 404);
    ok(res, { message: msg });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── POST /api/messages — save as draft ───────────────────────────────────────
router.post('/messages', (req, res) => {
  const err = validateMessage(req.body);
  if (err) return fail(res, err);

  try {
    const id         = uuidv4();
    const view_token = uuidv4();

    db.insertMessage({
      id,
      view_token,
      to_name:      req.body.to_name.trim(),
      to_contact:   req.body.to_contact.trim(),
      from_name:    req.body.from_name.trim(),
      body:         req.body.body.trim(),
      song:         req.body.song         || null,
      accent:       req.body.accent       || '#ae1417',
      font:         req.body.font         || 'serif',
      channel:      req.body.channel,
      status:       'draft',
      scheduled_at: req.body.scheduled_at || null,
    });

    ok(res, { id, view_token, view_url: buildViewUrl(view_token) });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── POST /api/messages/:id/send — send an existing draft ─────────────────────
router.post('/messages/:id/send', rateLimiter, async (req, res) => {
  const msg = db.getMessageById(req.params.id);
  if (!msg) return fail(res, 'Message not found', 404);
  if (msg.status === 'sent' || msg.status === 'read') {
    return fail(res, 'Message has already been sent');
  }

  try {
    const viewUrl = buildViewUrl(msg.view_token);
    if (msg.channel === 'email') {
      await sendEmail({ ...msg, viewUrl });
    } else {
      await sendWhatsApp({ ...msg, viewUrl });
    }
    db.markSent(msg.id);
    ok(res, { message: 'Sent successfully', channel: msg.channel, view_url: viewUrl });
  } catch (e) {
    db.markFailed(e.message, msg.id);
    fail(res, `Delivery failed: ${e.message}`, 502);
  }
});

// ── POST /api/messages/:id/resend — retry a failed message ───────────────────
router.post('/messages/:id/resend', rateLimiter, async (req, res) => {
  const msg = db.getMessageById(req.params.id);
  if (!msg) return fail(res, 'Message not found', 404);
  if (msg.retry_count >= 5) {
    return fail(res, 'Maximum retry attempts (5) reached for this message');
  }

  try {
    const viewUrl = buildViewUrl(msg.view_token);
    if (msg.channel === 'email') {
      await sendEmail({ ...msg, viewUrl });
    } else {
      await sendWhatsApp({ ...msg, viewUrl });
    }
    db.markSent(msg.id);
    ok(res, { message: 'Resent successfully', channel: msg.channel, view_url: viewUrl });
  } catch (e) {
    db.markFailed(e.message, msg.id);
    fail(res, `Resend failed: ${e.message}`, 502);
  }
});

// ── POST /api/send — create + send in one shot (main send endpoint) ───────────
router.post('/send', rateLimiter, async (req, res) => {
  const err = validateMessage(req.body);
  if (err) return fail(res, err);

  const id         = uuidv4();
  const view_token = uuidv4();
  const viewUrl    = buildViewUrl(view_token);

  const msgData = {
    id,
    view_token,
    to_name:      req.body.to_name.trim(),
    to_contact:   req.body.to_contact.trim(),
    from_name:    req.body.from_name.trim(),
    body:         req.body.body.trim(),
    song:         req.body.song   || null,
    accent:       req.body.accent || '#ae1417',
    font:         req.body.font   || 'serif',
    channel:      req.body.channel,
    status:       'draft',
    scheduled_at: null,
  };

  // Handle scheduled send — save as scheduled without sending now
  if (req.body.scheduled_at) {
    const scheduledDate = new Date(req.body.scheduled_at);
    if (isNaN(scheduledDate.getTime())) return fail(res, 'Invalid scheduled_at date');
    if (scheduledDate <= new Date()) return fail(res, 'Scheduled time must be in the future');
    msgData.scheduled_at = scheduledDate.toISOString();
    msgData.status = 'scheduled';
    db.insertMessage(msgData);
    ok(res, { id, view_token, view_url: viewUrl, status: 'scheduled', scheduled_at: msgData.scheduled_at });
    return;
  }

  // Immediate send
  try {
    db.insertMessage(msgData);
    if (req.body.channel === 'email') {
      await sendEmail({ ...msgData, viewUrl });
    } else {
      await sendWhatsApp({ ...msgData, viewUrl });
    }
    db.markSent(id);
    ok(res, { id, view_token, view_url: viewUrl, channel: req.body.channel, status: 'sent' });
  } catch (e) {
    db.markFailed(e.message, id);
    fail(res, `Send failed: ${e.message}`, 502);
  }
});

// ── DELETE /api/messages/:id ──────────────────────────────────────────────────
router.delete('/messages/:id', (req, res) => {
  try {
    const msg = db.getMessageById(req.params.id);
    if (!msg) return fail(res, 'Message not found', 404);
    db.deleteMessage(req.params.id);
    ok(res, { deleted: req.params.id });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── GET /api/stats ────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    ok(res, { stats: db.getStats() });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── GET /api/settings — get all runtime settings ─────────────────────────────
router.get('/settings', (req, res) => {
  try {
    const settings = db.getAllSettings();
    // Mask sensitive values
    const safe = {};
    for (const [k, v] of Object.entries(settings)) {
      safe[k] = k.toLowerCase().includes('pass') || k.toLowerCase().includes('token') || k.toLowerCase().includes('sid')
        ? v ? '••••••••' : ''
        : v;
    }
    ok(res, { settings: safe });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── POST /api/settings — save runtime config to DB ───────────────────────────
router.post('/settings', (req, res) => {
  try {
    const allowed = [
      'EMAIL_HOST','EMAIL_PORT','EMAIL_USER','EMAIL_PASS','EMAIL_FROM','EMAIL_SECURE',
      'TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_WHATSAPP_FROM','APP_URL',
    ];
    const saved = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined && req.body[key] !== '••••••••') {
        db.setSetting(key, req.body[key]);
        // Also apply to process.env for immediate effect
        process.env[key] = req.body[key];
        saved.push(key);
      }
    }
    ok(res, { saved });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── POST /api/settings/test-email — verify email credentials work ─────────────
router.post('/settings/test-email', rateLimiter, async (req, res) => {
  const testAddr = req.body.to || process.env.EMAIL_USER;
  if (!testAddr) return fail(res, 'Provide a "to" email address for the test');

  try {
    await sendEmail({
      to_contact: testAddr,
      to_name:    'Test Recipient',
      from_name:  'The Editorial Muse',
      body:       'If you can read this, your email configuration is working perfectly! 💌',
      song:       null,
      accent:     '#ae1417',
      viewUrl:    (process.env.APP_URL || 'http://localhost:3000') + '/view/test',
    });
    ok(res, { message: `Test email sent to ${testAddr}` });
  } catch (e) {
    fail(res, `Email test failed: ${e.message}`, 502);
  }
});

// ── POST /api/settings/test-whatsapp — verify WhatsApp credentials work ───────
router.post('/settings/test-whatsapp', rateLimiter, async (req, res) => {
  const phone = req.body.to;
  if (!phone) return fail(res, 'Provide a "to" phone number for the test (e.g. +2348012345678)');

  try {
    await sendWhatsApp({
      to_contact: phone,
      to_name:    'Test Recipient',
      from_name:  'The Editorial Muse',
      body:       'If you can read this, your WhatsApp configuration is working! 💌',
      song:       null,
      viewUrl:    (process.env.APP_URL || 'http://localhost:3000') + '/view/test',
    });
    ok(res, { message: `Test WhatsApp sent to ${phone}` });
  } catch (e) {
    fail(res, `WhatsApp test failed: ${e.message}`, 502);
  }
});

// ── GET /view/:token — public letter page with read tracking ─────────────────
router.get('/view/:token', (req, res) => {
  const msg = db.getByToken(req.params.token);
  if (!msg) {
    return res.status(404).send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Not Found</title><link href="https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;1,400&display=swap" rel="stylesheet"/></head><body style="background:#fdf9f0;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:'Noto Serif',serif"><div style="text-align:center;color:#805062"><p style="font-size:3rem;margin-bottom:16px">💌</p><h2 style="font-style:italic;font-size:1.5rem;margin-bottom:8px">Letter not found</h2><p style="font-size:.9rem;opacity:.7">This letter may have been deleted or the link is incorrect.</p></div></body></html>`);
  }

  db.recordView(req.params.token);

  const accent  = msg.accent || '#ae1417';
  const songHtml = msg.song && msg.song !== 'No song selected'
    ? `<div class="song">♪ <em>${esc(msg.song)}</em></div>` : '';
  const sentDate = new Date(msg.sent_at || msg.created_at)
    .toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>A letter for ${esc(msg.to_name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;1,400&family=Manrope:wght@400;600&display=swap" rel="stylesheet"/>
<style>
  :root{--accent:${accent}}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#fdf9f0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:48px 16px 80px;font-family:'Manrope',sans-serif}
  .brand{font-family:'Noto Serif',serif;font-style:italic;font-size:18px;color:#805062;margin-bottom:40px}
  .card{background:#fff;max-width:640px;width:100%;border-radius:20px;padding:52px 60px;border-top:4px solid var(--accent);box-shadow:0 40px 80px rgba(28,28,23,.09);animation:rise .7s ease both}
  @keyframes rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
  .to{font-family:'Noto Serif',serif;font-style:italic;font-size:1.6rem;color:#1c1c17;margin-bottom:24px}
  .rule{width:28px;height:1px;background:var(--accent);opacity:.45;margin-bottom:22px}
  .body{font-size:1rem;line-height:1.95;color:#5b403d;white-space:pre-wrap;margin-bottom:36px}
  .sig-wrap{text-align:right;border-top:1px solid #e4beba;padding-top:20px}
  .sig-lbl{font-size:.64rem;letter-spacing:.26em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
  .from{font-family:'Noto Serif',serif;font-style:italic;font-size:1.4rem;color:#1c1c17}
  .song{margin-top:24px;font-size:.8rem;color:#805062;padding-top:16px;border-top:1px solid #e4beba}
  .footer{margin-top:28px;text-align:center;font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:#8f6f6c}
  @media(max-width:540px){.card{padding:36px 24px}.to{font-size:1.3rem}}
</style>
</head>
<body>
  <p class="brand">The Editorial Muse</p>
  <div class="card">
    <p class="to">${esc(msg.to_name)},</p>
    <div class="rule"></div>
    <p class="body">${esc(msg.body)}</p>
    ${songHtml}
    <div class="sig-wrap">
      <p class="sig-lbl">With all my love,</p>
      <p class="from">${esc(msg.from_name)}</p>
    </div>
  </div>
  <p class="footer">Sent via The Editorial Muse &middot; ${sentDate}</p>
</body>
</html>`);
});

function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = router;

// ── Helpers ───────────────────────────────────────────────────────────────────
function ok(res, data)         { res.json({ success: true,  ...data }); }
function fail(res, msg, code)  { res.status(code || 400).json({ success: false, error: msg }); }

function validateMessage(body) {
  const { to_name, to_contact, from_name, body: text, channel } = body;
  if (!to_name?.trim())    return 'Recipient name is required';
  if (!to_contact?.trim()) return 'Recipient contact is required';
  if (!from_name?.trim())  return 'Sender name is required';
  if (!text?.trim())       return 'Message body is required';
  if (!['email','whatsapp'].includes(channel)) return 'Channel must be email or whatsapp';
  if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to_contact)) {
    return 'Invalid email address';
  }
  return null;
}

// ── GET /api/messages — list all messages ─────────────────────────────────────
router.get('/messages', (req, res) => {
  try {
    const messages = db.getAllMessages();
    ok(res, { messages });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── GET /api/messages/:id — single message ────────────────────────────────────
router.get('/messages/:id', (req, res) => {
  try {
    const msg = db.getMessageById(req.params.id);
    if (!msg) return fail(res, 'Message not found', 404);
    ok(res, { message: msg });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── POST /api/messages — save draft ───────────────────────────────────────────
router.post('/messages', (req, res) => {
  const err = validateMessage(req.body);
  if (err) return fail(res, err);

  try {
    const id         = uuidv4();
    const view_token = uuidv4();

    db.insertMessage({
      id,
      view_token,
      to_name:    req.body.to_name.trim(),
      to_contact: req.body.to_contact.trim(),
      from_name:  req.body.from_name.trim(),
      body:       req.body.body.trim(),
      song:       req.body.song   || null,
      accent:     req.body.accent || '#ae1417',
      font:       req.body.font   || 'serif',
      channel:    req.body.channel,
    });

    const appUrl  = process.env.APP_URL || 'http://localhost:3000';
    const viewUrl = `${appUrl}/view/${view_token}`;

    ok(res, { id, view_token, view_url: viewUrl });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── POST /api/messages/:id/send — deliver via chosen channel ──────────────────
router.post('/messages/:id/send', async (req, res) => {
  const msg = db.getMessageById(req.params.id);
  if (!msg) return fail(res, 'Message not found', 404);

  const appUrl  = process.env.APP_URL || 'http://localhost:3000';
  const viewUrl = `${appUrl}/view/${msg.view_token}`;

  try {
    if (msg.channel === 'email') {
      await sendEmail({ ...msg, viewUrl });
    } else {
      await sendWhatsApp({ ...msg, viewUrl });
    }

    db.markSent(msg.id);
    ok(res, { message: 'Message sent successfully', channel: msg.channel });
  } catch (e) {
    db.markFailed(e.message, msg.id);
    fail(res, `Delivery failed: ${e.message}`, 502);
  }
});

// ── POST /api/send — create + send in one shot ────────────────────────────────
router.post('/send', async (req, res) => {
  const err = validateMessage(req.body);
  if (err) return fail(res, err);

  try {
    const id         = uuidv4();
    const view_token = uuidv4();
    const appUrl     = process.env.APP_URL || 'http://localhost:3000';
    const viewUrl    = `${appUrl}/view/${view_token}`;

    const msgData = {
      id,
      view_token,
      to_name:    req.body.to_name.trim(),
      to_contact: req.body.to_contact.trim(),
      from_name:  req.body.from_name.trim(),
      body:       req.body.body.trim(),
      song:       req.body.song   || null,
      accent:     req.body.accent || '#ae1417',
      font:       req.body.font   || 'serif',
      channel:    req.body.channel,
    };

    db.insertMessage(msgData);

    if (req.body.channel === 'email') {
      await sendEmail({ ...msgData, viewUrl });
    } else {
      await sendWhatsApp({ ...msgData, viewUrl });
    }

    db.markSent(id);
    ok(res, { id, view_token, view_url: viewUrl, channel: req.body.channel });
  } catch (e) {
    fail(res, `Send failed: ${e.message}`, 502);
  }
});

// ── DELETE /api/messages/:id ──────────────────────────────────────────────────
router.delete('/messages/:id', (req, res) => {
  try {
    const msg = db.getMessageById(req.params.id);
    if (!msg) return fail(res, 'Message not found', 404);
    db.deleteMessage(req.params.id);
    ok(res, { deleted: req.params.id });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── GET /api/stats ────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    ok(res, { stats: db.getStats() });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

// ── GET /view/:token — public letter view page (tracks opens) ─────────────────
router.get('/view/:token', (req, res) => {
  const msg = db.getByToken(req.params.token);
  if (!msg) {
    return res.status(404).send('<h2 style="font-family:Georgia,serif;text-align:center;padding:80px;color:#805062">This letter could not be found.</h2>');
  }

  // Record the view
  db.recordView(req.params.token);

  const accent = msg.accent || '#ae1417';
  const song   = msg.song && msg.song !== 'No song selected'
    ? `<div class="song"><span>♪</span> ${esc(msg.song)}</div>` : '';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>A letter for ${esc(msg.to_name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;1,400&family=Manrope:wght@400;600&display=swap" rel="stylesheet"/>
<style>
  :root{--accent:${accent}}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#fdf9f0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:48px 16px 80px;font-family:'Manrope',sans-serif}
  .brand{font-family:'Noto Serif',serif;font-style:italic;font-size:18px;color:#805062;margin-bottom:40px;letter-spacing:.02em}
  .card{background:#fff;max-width:620px;width:100%;border-radius:20px;padding:52px 60px;border-top:3px solid var(--accent);box-shadow:0 40px 80px rgba(28,28,23,.09);animation:rise .7s ease forwards}
  @keyframes rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  .to{font-family:'Noto Serif',serif;font-style:italic;font-size:1.5rem;color:#1c1c17;margin-bottom:24px}
  .rule{width:24px;height:1px;background:var(--accent);opacity:.4;margin-bottom:20px}
  .body{font-size:1rem;line-height:1.9;color:#5b403d;white-space:pre-wrap;margin-bottom:36px}
  .sig-wrap{text-align:right;border-top:1px solid #e4beba;padding-top:18px;margin-top:8px}
  .sig-lbl{font-size:.65rem;letter-spacing:.25em;text-transform:uppercase;color:var(--accent);margin-bottom:5px}
  .from{font-family:'Noto Serif',serif;font-style:italic;font-size:1.3rem;color:#1c1c17}
  .song{margin-top:24px;font-size:.8rem;color:#805062;display:flex;align-items:center;gap:8px}
  .footer{margin-top:32px;text-align:center;font-size:.7rem;letter-spacing:.15em;text-transform:uppercase;color:#8f6f6c}
  @media(max-width:520px){.card{padding:36px 24px}.to{font-size:1.25rem}}
</style>
</head>
<body>
  <p class="brand">The Editorial Muse</p>
  <div class="card">
    <p class="to">${esc(msg.to_name)},</p>
    <div class="rule"></div>
    <p class="body">${esc(msg.body)}</p>
    ${song}
    <div class="sig-wrap">
      <p class="sig-lbl">With all my love,</p>
      <p class="from">${esc(msg.from_name)}</p>
    </div>
  </div>
  <p class="footer">Sent via The Editorial Muse · ${new Date(msg.sent_at || msg.created_at).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p>
</body>
</html>`);
});

function esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = router;
