// server/emailService.js — using official Brevo SDK
'use strict';

const { BrevoClient } = require('@getbrevo/brevo');
const crypto          = require('crypto');

// ── Encryption helpers ────────────────────────────────────────────────────────
function getSecret() {
  const s = process.env.LETTER_SECRET;
  if (!s) throw new Error('LETTER_SECRET not set in environment variables');
  return crypto.createHash('sha256').update(s).digest();
}

function encryptBody(text) {
  const key = getSecret();
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptBody(stored) {
  const key = getSecret();
  const [ivHex, encHex] = stored.split(':');
  const iv        = Buffer.from(ivHex,  'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher  = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
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
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY not set in environment variables');

  const fromEmail = process.env.EMAIL_FROM_ADDRESS || 'editorialmuse07@gmail.com';
  const fromName  = 'The Editorial Muse';

  const brevo = new BrevoClient({ apiKey });

  const result = await brevo.transactionalEmails.sendTransacEmail({
    sender:      { name: fromName, email: fromEmail },
    to:          [{ email: to_contact, name: to_name }],
    subject:     `${from_name} wrote you a letter 💌`,
    textContent: `${to_name},\n\n${body}\n\nWith all my love,\n${from_name}\n\n${song ? '♪ ' + song + '\n\n' : ''}Open the beautiful version: ${viewUrl}`,
    htmlContent: buildEmailHtml({ to_name, from_name, body, song, accent, viewUrl }),
  });

  console.log(`[Email] ✓ Sent to ${to_contact} — ID: ${result.messageId}`);
  return result;
}

// ── Warm up / env check ───────────────────────────────────────────────────────
function warmUpEmail() {
  if (!process.env.BREVO_API_KEY) {
    console.warn('[Email] BREVO_API_KEY not set — email sending will fail');
  } else {
    console.log('[Email] Brevo API ready ✓');
  }
  if (!process.env.LETTER_SECRET) {
    console.warn('[Email] LETTER_SECRET not set — letter encryption will fail');
  } else {
    console.log('[Email] Letter encryption ready ✓');
  }
}

module.exports = { sendEmail, warmUpEmail, encryptBody, decryptBody };
