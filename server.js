require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

const origins = String(process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origins.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked: ' + origin));
  },
  methods: ['POST', 'GET'],
}));

app.use(express.json({ limit: '12mb' }));

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

app.get('/', (_req, res) => {
  res.send('MOODIARY Mail API is running');
});

const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function parseDataUrlImage(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null;
  const [meta, b64] = dataUrl.split(',');
  if (!b64) return null;
  const isPng = /png/i.test(meta);
  const isJpeg = /jpe?g/i.test(meta);
  return {
    buffer: Buffer.from(b64, 'base64'),
    ext: isPng ? 'png' : (isJpeg ? 'jpg' : 'bin'),
    contentType: isPng ? 'image/png' : (isJpeg ? 'image/jpeg' : 'application/octet-stream'),
  };
}

app.post('/api/send-email', async (req, res) => {
  try {
    const { to_email, subject, message, image_data, date } = req.body || {};
    if (!to_email) return res.status(400).json({ ok: false, error: 'to_email required' });
    if (!isEmail(to_email)) return res.status(400).json({ ok: false, error: 'Invalid email' });

    let attachment = null;
    if (image_data) {
      const parsed = parseDataUrlImage(image_data);
      if (!parsed) return res.status(400).json({ ok: false, error: 'Invalid image data' });
      if (parsed.buffer.length > 6 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: 'Image too large' });
      }
      attachment = {
        filename: `moodiary-${date || 'capture'}.${parsed.ext}`,
        content: parsed.buffer,
        contentType: parsed.contentType,
      };
    }

    const htmlBody = `
      <div style="font:14px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <p>${(message || '안녕하세요, MOODIARY에서 만든 정원 캡처를 첨부합니다.').replace(/\n/g, '<br>')}</p>
        ${image_data ? `<p>아래는 미리보기입니다:</p><img src="${image_data}" style="max-width:600px;height:auto;border:1px solid #eee"/>` : ''}
        <p style="color:#999;margin-top:16px;">보낸 시각: ${new Date().toLocaleString()}</p>
      </div>
    `;

    const mailOptions = {
      from: `"${process.env.FROM_NAME || 'MOODIARY'}" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
      to: to_email,
      subject: subject || `MOODIARY 정원 캡처 - ${date || ''}`,
      html: htmlBody,
      attachments: attachment ? [attachment] : [],
    };

    const info = await transporter.sendMail(mailOptions);
    return res.json({ ok: true, id: info.messageId });
  } catch (err) {
    console.error('send-email error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Internal Server Error' });
  }
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log('Mail API listening on http://localhost:' + PORT));
