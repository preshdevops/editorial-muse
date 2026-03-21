// server/emailService.js
const nodemailer = require('nodemailer');

// ── Transporter (lazy-init so missing env vars don't crash startup) ────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('Email not configured. Set EMAIL_USER and EMAIL_PASS in .env');
  }

  _transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST  || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  return _transporter;
}

// ── HTML email template ────────────────────────────────────────────────────────
function buildEmailHtml({ to_name, from_name, body, song, accent, viewUrl }) {
  const accentSafe = accent || '#ae1417';
  const songLine   = song && song !== 'No song selected'
    ? `<p style="margin:28px 0 0;font-size:13px;color:#805062;">♪ ${escHtml(song)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>A letter for you</title>
</head>
<body style="margin:0;padding:0;background:#fdf9f0;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf9f0;padding:48px 16px;">
  <tr><td align="center">

    <!-- Header -->
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">
      <tr>
        <td style="padding-bottom:32px;text-align:center;">
          <p style="margin:0;font-family:'Georgia',serif;font-style:italic;font-size:22px;color:#805062;">The Editorial Muse</p>
          <p style="margin:6px 0 0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8f6f6c;">A letter has arrived for you</p>
        </td>
      </tr>
    </table>

    <!-- Card -->
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(28,28,23,.08);">
      <!-- Accent bar -->
      <tr><td style="height:4px;background:${accentSafe};"></td></tr>

      <!-- Body -->
      <tr>
        <td style="padding:52px 60px 44px;">
          <p style="margin:0 0 28px;font-family:'Georgia',serif;font-style:italic;font-size:26px;color:#1c1c17;">${escHtml(to_name)},</p>
          <div style="width:28px;height:1px;background:${accentSafe};opacity:.4;margin-bottom:24px;"></div>
          <p style="margin:0;font-family:'Georgia',serif;font-size:16px;line-height:1.9;color:#5b403d;white-space:pre-wrap;">${escHtml(body)}</p>
          ${songLine}
          <div style="margin-top:40px;text-align:right;border-top:1px solid #e4beba;padding-top:20px;">
            <p style="margin:0 0 4px;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:${accentSafe};">With all my love,</p>
            <p style="margin:0;font-family:'Georgia',serif;font-style:italic;font-size:22px;color:#1c1c17;">${escHtml(from_name)}</p>
          </div>
        </td>
      </tr>

      <!-- View button -->
      <tr>
        <td style="padding:0 60px 52px;">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:${accentSafe};border-radius:9999px;padding:14px 32px;">
                <a href="${viewUrl}" style="color:#ffffff;text-decoration:none;font-family:'Helvetica',sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;">Open Beautiful Version →</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Footer -->
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin-top:32px;">
      <tr>
        <td style="text-align:center;padding:0 0 48px;">
          <p style="margin:0;font-size:11px;color:#8f6f6c;letter-spacing:.1em;text-transform:uppercase;">Sent via The Editorial Muse</p>
        </td>
      </tr>
    </table>

  </td></tr>
</table>
</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Send function ─────────────────────────────────────────────────────────────
async function sendEmail({ to_contact, to_name, from_name, body, song, accent, viewUrl }) {
  const transporter = getTransporter();

  const info = await transporter.sendMail({
    from:    process.env.EMAIL_FROM || `"The Editorial Muse" <${process.env.EMAIL_USER}>`,
    to:      to_contact,
    subject: `${from_name} wrote you a letter 💌`,
    text:    `${to_name},\n\n${body}\n\nWith all my love,\n${from_name}\n\n♪ ${song || ''}\n\nView the beautiful version: ${viewUrl}`,
    html:    buildEmailHtml({ to_name, from_name, body, song, accent, viewUrl }),
  });

  return info;
}

module.exports = { sendEmail };
