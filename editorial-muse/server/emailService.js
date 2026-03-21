// server/emailService.js — using Resend API (fast, reliable, no SMTP timeouts)
'use strict';

const https = require('https');

// ── Send via Resend API ───────────────────────────────────────────────────────
function resendRequest(payload) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY not set in environment variables');

    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.message || parsed.name || `Resend error ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error('Invalid Resend response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Resend request timed out')); });
    req.write(body);
    req.end();
  });
}

// ── HTML email template ───────────────────────────────────────────────────────
function buildEmailHtml({ to_name, from_name, body, song, accent, viewUrl }) {
  const acc = accent || '#ae1417';
  const songLine = song && song !== 'No song selected'
    ? `<p style="margin:28px 0 0;font-size:13px;color:#805062;">♪ ${esc(song)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>A letter for you</title></head>
<body style="margin:0;padding:0;background:#fdf9f0;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf9f0;padding:48px 16px;">
<tr><td align="center">

  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">
    <tr><td style="padding-bottom:32px;text-align:center;">
      <p style="margin:0;font-family:'Georgia',serif;font-style:italic;font-size:22px;color:#805062;">The Editorial Muse</p>
      <p style="margin:6px 0 0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8f6f6c;">A letter has arrived for you</p>
    </td></tr>
  </table>

  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(28,28,23,.08);">
    <tr><td style="height:4px;background:${acc};"></td></tr>
    <tr><td style="padding:52px 60px 44px;">
      <p style="margin:0 0 28px;font-family:'Georgia',serif;font-style:italic;font-size:26px;color:#1c1c17;">${esc(to_name)},</p>
      <div style="width:28px;height:1px;background:${acc};opacity:.4;margin-bottom:24px;"></div>
      <p style="margin:0;font-family:'Georgia',serif;font-size:16px;line-height:1.9;color:#5b403d;white-space:pre-wrap;">${esc(body)}</p>
      ${songLine}
      <div style="margin-top:40px;text-align:right;border-top:1px solid #e4beba;padding-top:20px;">
        <p style="margin:0 0 4px;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:${acc};">With all my love,</p>
        <p style="margin:0;font-family:'Georgia',serif;font-style:italic;font-size:22px;color:#1c1c17;">${esc(from_name)}</p>
      </div>
    </td></tr>
    <tr><td style="padding:0 60px 52px;">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="background:${acc};border-radius:9999px;padding:14px 32px;">
          <a href="${viewUrl}" style="color:#ffffff;text-decoration:none;font-family:'Helvetica',sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;">Open Beautiful Version →</a>
        </td>
      </tr></table>
    </td></tr>
  </table>

  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin-top:32px;">
    <tr><td style="text-align:center;padding:0 0 48px;">
      <p style="margin:0;font-size:11px;color:#8f6f6c;letter-spacing:.1em;text-transform:uppercase;">Sent via The Editorial Muse</p>
    </td></tr>
  </table>

</td></tr>
</table>
</body></html>`;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Main send function ────────────────────────────────────────────────────────
async function sendEmail({ to_contact, to_name, from_name, body, song, accent, viewUrl }) {
  const fromAddress = process.env.EMAIL_FROM || 'The Editorial Muse <onboarding@resend.dev>';

  const payload = {
    from:    fromAddress,
    to:      [to_contact],
    subject: `${from_name} wrote you a letter 💌`,
    text:    `${to_name},\n\n${body}\n\nWith all my love,\n${from_name}\n\n${song ? '♪ ' + song + '\n\n' : ''}Open the beautiful version: ${viewUrl}`,
    html:    buildEmailHtml({ to_name, from_name, body, song, accent, viewUrl }),
  };

  const result = await resendRequest(payload);
  console.log(`[Email] ✓ Sent to ${to_contact} — ID: ${result.id}`);
  return result;
}

// Kept for compatibility with index.js import
function warmUpEmail() {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Email] RESEND_API_KEY not set — email sending will fail');
  } else {
    console.log('[Email] Resend API ready ✓');
  }
}

module.exports = { sendEmail, warmUpEmail };
