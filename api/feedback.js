import { google } from 'googleapis';
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, source, email = null } = req.body || {};
  if (!message) return res.status(400).json({ error: 'No message provided' });

  try {
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      parsed = {
        summary: message,
        area: 'General',
        issue: message,
        suggested_change: '',
      };
    }

    const now = new Date();
    const iso = now.toISOString();
    const localTime = now.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });

    const memoryId = crypto.randomUUID();
    const memoryRecord = {
      id: memoryId,
      summary: parsed.summary || '',
      area: parsed.area || 'General',
      issue: parsed.issue || '',
      suggested_change: parsed.suggested_change || '',
      raw_feedback: message,
      source: source || 'Page',
      email,
      status: 'pending',
      created_at: iso,
      updated_at: iso,
      fixed_note: '',
    };

    await kv.set(`feedback:${memoryId}`, memoryRecord);
    await kv.zadd('feedback:timeline', {
      score: Date.now(),
      member: JSON.stringify(memoryRecord),
    });

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    const drive = google.drive({ version: 'v3', auth });

    const filename = `Feedback_${iso.replace(/[:.]/g, '-')}.txt`;
    const content = [
      'MR P AGENT FEEDBACK',
      '────────────────────────────────────────',
      `Memory ID: ${memoryId}`,
      `Date: ${localTime}`,
      `Source: ${source || 'Page'}`,
      `Email: ${email || 'Not provided'}`,
      'Status: pending',
      '',
      'Summary:',
      parsed.summary || '',
      '',
      'Area:',
      parsed.area || 'General',
      '',
      'Issue:',
      parsed.issue || '',
      '',
      'Suggested Change:',
      parsed.suggested_change || '',
      '',
      'Raw Feedback:',
      message,
      '',
    ].join('\n');

    await drive.files.create({
      requestBody: {
        name: filename,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
        mimeType: 'text/plain',
      },
      media: {
        mimeType: 'text/plain',
        body: content,
      },
    });

    return res.status(200).json({ success: true, id: memoryId });
  } catch (err) {
    console.error('Drive/Memory error:', err);
    return res.status(500).json({ error: 'Could not save feedback' });
  }
}
