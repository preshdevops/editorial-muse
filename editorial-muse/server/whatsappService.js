// server/whatsappService.js
// Uses the Twilio REST API directly (no SDK needed — just fetch/https)
const https = require('https');

function twilioRequest(path, body) {
  return new Promise((resolve, reject) => {
    const sid  = process.env.TWILIO_ACCOUNT_SID;
    const auth = process.env.TWILIO_AUTH_TOKEN;

    if (!sid || !auth) {
      return reject(new Error('WhatsApp not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env'));
    }

    const postData = new URLSearchParams(body).toString();
    const options = {
      hostname: 'api.twilio.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization':  'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'),
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
            reject(new Error(parsed.message || `Twilio error ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error('Invalid Twilio response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Format the WhatsApp message ────────────────────────────────────────────────
function buildWhatsAppText({ to_name, from_name, body, song, viewUrl }) {
  const songLine = (song && song !== 'No song selected') ? `\n♪ _${song}_` : '';
  return [
    `💌 *A letter for ${to_name}*`,
    ``,
    `_${to_name},_`,
    ``,
    body.length > 400 ? body.slice(0, 400) + '…' : body,
    ``,
    `_With all my love,_`,
    `*${from_name}*`,
    songLine,
    ``,
    `🔗 Read the beautiful version:`,
    viewUrl,
  ].filter(l => l !== undefined).join('\n');
}

// ── Send function ─────────────────────────────────────────────────────────────
async function sendWhatsApp({ to_contact, to_name, from_name, body, song, viewUrl }) {
  const sid  = process.env.TWILIO_ACCOUNT_SID;
  const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

  // Normalise phone — must be e.164 format: +2348012345678
  let phone = to_contact.replace(/[\s\-\(\)]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;

  const result = await twilioRequest(
    `/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      From: from,
      To:   `whatsapp:${phone}`,
      Body: buildWhatsAppText({ to_name, from_name, body, song, viewUrl }),
    }
  );

  return result;
}

module.exports = { sendWhatsApp };
