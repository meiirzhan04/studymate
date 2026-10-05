import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  const allowedOrigins = [
    'https://studymate-mu-smoky.vercel.app',
    'https://studymate.vercel.app',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
  ];
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://studymate-mu-smoky.vercel.app');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Mailer-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Internal secret check if configured in environment
  const expectedSecret = process.env.MAILER_SECRET_KEY;
  if (expectedSecret) {
    const providedSecret = req.headers['x-mailer-secret'];
    if (providedSecret !== expectedSecret) {
      return res.status(403).json({ ok: false, error: 'Unauthorized mailer request' });
    }
  }

  const { to, code } = req.body || {};
  if (!to || !code || !/^\d{6}$/.test(String(code).trim())) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid recipient email (to) or 6-digit verification code' });
  }

  const cleanCode = String(code).trim();
  const gmailUser = process.env.GMAIL_USER || process.env.SMTP_USER || 'amirzhanmeirzhan5@gmail.com';
  const gmailPass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || 'ewsa dvkt cjdw cjlt';

  if (!gmailUser || !gmailPass) {
    return res.status(500).json({
      ok: false,
      error: 'SMTP credentials are not configured on this server environment.',
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: {
        user: gmailUser,
        pass: gmailPass.replace(/\s+/g, ''),
      },
    });

    const mailOptions = {
      from: `"StudyMate Portal" <${gmailUser}>`,
      to: to,
      subject: `StudyMate - Password Reset Code: ${cleanCode}`,
      text: `Hello!\n\nYour 6-digit password reset verification code is:\n\n  ${cleanCode}\n\nThis code will expire in 15 minutes.\nIf you did not request this password reset, please ignore this email.\n\n— StudyMate Academic Team`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #F9FAFB; margin: 0; padding: 24px; color: #111827; }
            .card { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #E5E7EB; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
            .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
            .logo { background: #5B4FCF; color: #fff; width: 36px; height: 36px; border-radius: 10px; font-weight: 800; font-size: 18px; display: inline-flex; align-items: center; justify-content: center; }
            .name { font-size: 20px; font-weight: 800; color: #111827; }
            .code-box { text-align: center; margin: 28px 0; background: #EEF2FF; border: 2px dashed #6366F1; border-radius: 12px; padding: 18px 24px; }
            .code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #4F46E5; font-family: monospace; }
            .footer { margin-top: 24px; padding-top: 18px; border-top: 1px solid #F3F4F6; font-size: 13px; color: #6B7280; text-align: center; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="brand">
              <span class="logo">S</span>
              <span class="name">StudyMate</span>
            </div>
            <h2 style="margin: 0 0 12px; font-size: 20px; color: #111827;">Password Reset Verification</h2>
            <p style="margin: 0 0 16px; color: #4B5563; font-size: 15px; line-height: 1.5;">
              You requested to reset your password for your <strong>StudyMate</strong> account. Use the verification code below to proceed:
            </p>
            <div class="code-box">
              <div class="code">${cleanCode}</div>
            </div>
            <p style="margin: 0 0 8px; color: #6B7280; font-size: 13px; line-height: 1.4;">
              ⏱ <strong>Note:</strong> This verification code is single-use and will expire in 15 minutes.
            </p>
            <p style="margin: 0; color: #9CA3AF; font-size: 12px; line-height: 1.4;">
              If you didn't initiate this request, you can safely disregard this email. Your password will remain unchanged.
            </p>
            <div class="footer">
              StudyMate Academic Performance Monitor &bull; SDU Student Portal
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    return res.status(200).json({ ok: true, messageId: info.messageId });
  } catch (err) {
    console.error('Mail delivery failure:', err);
    return res.status(500).json({ ok: false, error: 'Internal mail delivery failure' });
  }
}
