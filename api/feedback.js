// api/feedback.js — Vercel serverless function
// Receives feedback and saves it as a Google Doc in your Drive folder

import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, source } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });

  try {
    // ── Authenticate with Google using service account ──
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // ── Create a text file in your MRP Feedback folder ──
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `Feedback_${timestamp}.txt`;
    const content = `MR P AGENT FEEDBACK\n${'─'.repeat(40)}\nDate: ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\nSource: ${source || 'Page'}\n\n${message}\n`;

    await drive.files.create({
      requestBody: {
        name: filename,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID], // your MRP Feedback folder ID
        mimeType: 'text/plain',
      },
      media: {
        mimeType: 'text/plain',
        body: content,
      },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Drive error:', err);
    return res.status(500).json({ error: 'Could not save feedback' });
  }
}
