# 💌 The Editorial Muse — Full-Stack Setup Guide

A romantic letter app with Email & WhatsApp delivery, read tracking, and an inbox dashboard.

---

## 🗂 Project Structure

```
editorial-muse/
├── server/
│   ├── index.js          ← Express server entry point
│   ├── routes.js         ← All API routes + /view/:token page
│   ├── db.js             ← SQLite database (auto-creates muse.db)
│   ├── emailService.js   ← Nodemailer email delivery
│   └── whatsappService.js← Twilio WhatsApp delivery
├── public/
│   └── index.html        ← Frontend (served as SPA)
├── data/
│   └── muse.db           ← Auto-created SQLite database
├── .env.example          ← Copy this to .env and fill in your keys
├── package.json
└── README.md
```

---

## 🚀 Quick Start (5 minutes)

### 1. Install Node.js
Download from https://nodejs.org (v18 or later recommended)

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
```
Then open `.env` in any text editor and fill in your credentials (see below).

### 4. Start the server
```bash
npm start
```

Open http://localhost:3000 in your browser. 🎉

---

## 📧 Email Setup (Gmail)

Gmail is the easiest option. You'll need an **App Password** (not your regular password).

**Step 1:** Enable 2-Factor Authentication on your Google account
- Go to myaccount.google.com → Security → 2-Step Verification → Turn On

**Step 2:** Create an App Password
- Go to myaccount.google.com → Security → App passwords
- Select "Mail" and your device, click Generate
- Copy the 16-character password

**Step 3:** Add to your `.env`:
```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your.email@gmail.com
EMAIL_PASS=abcd efgh ijkl mnop   ← the 16-char app password (spaces OK)
EMAIL_FROM="The Editorial Muse <your.email@gmail.com>"
```

### Other email providers
| Provider   | HOST                  | PORT | SECURE |
|------------|----------------------|------|--------|
| Outlook    | smtp.office365.com   | 587  | false  |
| Yahoo      | smtp.mail.yahoo.com  | 587  | false  |
| SendGrid   | smtp.sendgrid.net    | 587  | false  |
| Mailgun    | smtp.mailgun.org     | 587  | false  |

---

## 📱 WhatsApp Setup (Twilio)

Twilio provides a WhatsApp sandbox for free testing.

**Step 1:** Sign up at https://www.twilio.com (free trial available)

**Step 2:** Get your credentials
- Go to console.twilio.com/dashboard
- Copy your **Account SID** and **Auth Token**

**Step 3:** Activate the WhatsApp Sandbox
- Go to console.twilio.com → Messaging → Try it out → Send a WhatsApp message
- Follow the instructions to join the sandbox (send a specific message from your phone)
- Your sandbox number will be something like `+14155238886`

**Step 4:** Add to your `.env`:
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

> **Note:** In sandbox mode, the recipient must also join the sandbox by sending the code to the sandbox number. For production, you need to apply for a WhatsApp Business number through Twilio.

### Phone number format
Recipients must be in E.164 format: `+[country code][number]`
- Nigeria: `+2348012345678`
- UK: `+447911123456`
- USA: `+12125551234`

---

## 🌐 API Endpoints

| Method | Endpoint                   | Description                          |
|--------|---------------------------|--------------------------------------|
| GET    | `/api/messages`            | List all messages                    |
| GET    | `/api/messages/:id`        | Get single message                   |
| POST   | `/api/messages`            | Save draft (does not send)           |
| POST   | `/api/messages/:id/send`   | Send a saved draft                   |
| POST   | `/api/send`                | Create + send in one request         |
| DELETE | `/api/messages/:id`        | Delete a message                     |
| GET    | `/api/stats`               | Dashboard stats                      |
| GET    | `/view/:token`             | Public letter view page (tracks opens)|

### Example: Send via API
```bash
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "to_name": "Sarah",
    "to_contact": "sarah@example.com",
    "from_name": "James",
    "body": "Every second away from you feels like a season lost.",
    "song": "At Last",
    "channel": "email",
    "accent": "#ae1417"
  }'
```

---

## ☁️ Deployment

### Render.com (Free tier — recommended)
1. Push this folder to a GitHub repo
2. Go to render.com → New → Web Service
3. Connect your GitHub repo
4. Set:
   - Build command: `npm install`
   - Start command: `npm start`
5. Add all your `.env` variables under "Environment"
6. Deploy!

### Railway.app
1. Install Railway CLI: `npm install -g @railway/cli`
2. `railway login && railway init && railway up`
3. Set env vars: `railway variables set EMAIL_USER=... EMAIL_PASS=...`

### DigitalOcean App Platform
1. Create a new App → connect GitHub
2. Set run command to `npm start`
3. Add environment variables in the App settings

### VPS / Self-hosted (Ubuntu)
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone or upload your project, then:
cd editorial-muse
npm install

# Install PM2 to keep it running
npm install -g pm2
pm2 start server/index.js --name editorial-muse
pm2 startup   # auto-start on reboot
pm2 save

# Optionally put Nginx in front for HTTPS
```

---

## 🔧 Customisation

### Add more songs to the music player
In `public/index.html`, find the `SONGS` array and add entries:
```js
{ name:'Your Song Name', notes:[...Hz values...], tempo:450, wave:'sine', gain:.16 }
```

### Change the database location
In `server/db.js`, edit `DATA_DIR`:
```js
const DATA_DIR = '/your/custom/path';
```

### Add authentication
The API has no auth by default. For a personal app this is fine.
For a multi-user app, add a middleware like `express-session` or JWT.

---

## 📋 Environment Variables Reference

| Variable               | Required | Description                              |
|-----------------------|----------|------------------------------------------|
| `PORT`                 | No       | Server port (default: 3000)              |
| `EMAIL_HOST`           | Yes*     | SMTP hostname                            |
| `EMAIL_PORT`           | Yes*     | SMTP port (usually 587)                  |
| `EMAIL_USER`           | Yes*     | Your email address                       |
| `EMAIL_PASS`           | Yes*     | App password (not your login password)   |
| `EMAIL_FROM`           | No       | From display name + address              |
| `TWILIO_ACCOUNT_SID`   | Yes**    | Twilio Account SID                       |
| `TWILIO_AUTH_TOKEN`    | Yes**    | Twilio Auth Token                        |
| `TWILIO_WHATSAPP_FROM` | No       | Twilio sandbox number                    |
| `APP_URL`              | No       | Your deployed URL (for share links)      |

*Required for email sending
**Required for WhatsApp sending

---

Made with ♥ by The Editorial Muse
