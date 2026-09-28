import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { to, code } = req.body || {};
  if (!to || !code) {
    return res.status(400).json({ ok: false, error: 'Missing recipient email (to) or verification code' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: 'amirzhanmeirzhan5@gmail.com',
        pass: 'ewsadvktcjdwcjlt',
      },
    });

    const mailOptions = {
      from: '"StudyMate Portal" <amirzhanmeirzhan5@gmail.com>',
      to: to,
      subject: `StudyMate - Password Reset Code: ${code}`,
      text: `Hello!\n\nYour 6-digit password reset verification code is:\n\n  ${code}\n\nThis code will expire in 15 minutes.\nIf you did not request this password reset, please ignore this email.\n\n— StudyMate Academic Team`,
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
              You requested a password reset for your StudyMate account. Use this 6-digit verification code to proceed:
            </p>
            <div class="code-box">
              <div class="code">${code}</div>
            </div>
            <p style="margin: 0; color: #6B7280; font-size: 13px;">
              ⏱ This code is valid for <b>15 minutes</b>. Never share this code with anyone.
            </p>
            <div class="footer">
              If you didn't request this code, you can safely ignore this email.<br>
              © 2026 StudyMate Portal
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    return res.status(200).json({ ok: true, message: `Email delivered successfully to ${to}` });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
