import { google } from 'googleapis';
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, source, email = null } = req.body || {};

  if (!message) {
    return res.status(400).json({ error: 'No message provided' });
  }

  try {
    let parsed;
    try {
      parsed = typeof message === 'string' ? JSON.parse(message) : message;
    } catch {
      parsed = {
        summary: String(message),
        area: 'General',
        issue: String(message),
        suggested_change: '',
      };
    }

    const now = new Date();
    const iso = now.toISOString();
    const localTime = now.toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
    });

    const feedbackId = crypto.randomUUID();

    const record = {
      id: feedbackId,
      summary: parsed.summary || '',
      area: parsed.area || 'General',
      issue: parsed.issue || '',
      suggested_change: parsed.suggested_change || '',
      raw_feedback: typeof message === 'string' ? message : JSON.stringify(message),
      source: source || 'Page',
      email,
      status: 'pending',
      created_at: iso,
      updated_at: iso,
      fixed_note: '',
      fixed_at: null,
      resolved_by: null,
    };

    // Save structured memory for Lily
    await kv.lpush('feedback_memory', JSON.stringify(record));
    await kv.ltrim('feedback_memory', 0, 49);

    // Save individually for future dev-agent updates
    await kv.set(`feedback:${feedbackId}`, record);

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
      `Feedback ID: ${feedbackId}`,
      `Date: ${localTime}`,
      `Source: ${source || 'Page'}`,
      `Email: ${email || 'Not provided'}`,
      `Status: pending`,
      '',
      'Summary:',
      record.summary,
      '',
      'Area:',
      record.area,
      '',
      'Issue:',
      record.issue,
      '',
      'Suggested Change:',
      record.suggested_change,
      '',
      'Raw Feedback:',
      record.raw_feedback,
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

    return res.status(200).json({
      success: true,
      id: feedbackId,
    });
  } catch (err) {
    console.error('Feedback save error:', err);
    return res.status(500).json({ error: 'Could not save feedback' });
  }
}
