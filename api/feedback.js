// api/feedback.js
// Stores Lana feedback in:
// 1) Vercel KV memory
// 2) Google Drive folder

const { kv } = require('@vercel/kv');
const { google } = require('googleapis');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeFeedback(rawMessage, source) {
  let parsed = rawMessage;

  if (typeof rawMessage === 'string') {
    parsed = safeJsonParse(rawMessage, null);
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      title: 'Mr P feedback',
      category: 'general',
      priority: 'normal',
      summary: typeof rawMessage === 'string' ? rawMessage : 'General feedback',
      details: typeof rawMessage === 'string' ? rawMessage : 'General feedback',
      user_message: typeof rawMessage === 'string' ? rawMessage : '',
      status: 'new',
      source: source || 'lana-chat',
    };
  }

  return {
    title:
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : 'Mr P feedback',
    category:
      typeof parsed.category === 'string' && parsed.category.trim()
        ? parsed.category.trim()
        : 'general',
    priority:
      typeof parsed.priority === 'string' && parsed.priority.trim()
        ? parsed.priority.trim()
        : 'normal',
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : 'General feedback',
    details:
      typeof parsed.details === 'string' && parsed.details.trim()
        ? parsed.details.trim()
        : 'General feedback',
    user_message:
      typeof parsed.user_message === 'string'
        ? parsed.user_message.trim()
        : '',
    status:
      typeof parsed.status === 'string' && parsed.status.trim()
        ? parsed.status.trim()
        : 'new',
    source: source || 'lana-chat',
  };
}

async function writeToGoogleDrive(record) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
    throw new Error('Missing Google Drive environment variables');
  }

  const credentials = safeJsonParse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, null);
  if (!credentials) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  const drive = google.drive({ version: 'v3', auth });

  const driveBody = [
    'MR P FEEDBACK',
    '==============================',
    `ID: ${record.id}`,
    `Title: ${record.title}`,
    `Category: ${record.category}`,
    `Priority: ${record.priority}`,
    `Status: ${record.status}`,
    `Source: ${record.source}`,
    `Submitted At: ${record.submitted_at}`,
    '',
    'SUMMARY',
    record.summary,
    '',
    'DETAILS',
    record.details,
    '',
    'USER MESSAGE',
    record.user_message || '',
    '',
  ].join('\n');

  const filenameSafeTitle =
    record.title
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'feedback';

  const fileName = `${record.submitted_at.slice(0, 10)}-${filenameSafeTitle}-${record.id}.txt`;

  const driveResult = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      mimeType: 'text/plain',
    },
    media: {
      mimeType: 'text/plain',
      body: driveBody,
    },
    fields: 'id,name,webViewLink,parents',
  });

  console.log('Drive upload success:', driveResult.data);

  return driveResult.data;
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, source } = req.body || {};

  if (!message) {
    return res.status(400).json({ error: 'No message provided' });
  }

  try {
    const normalized = normalizeFeedback(message, source);
    const submittedAt = new Date().toISOString();
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `fb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const record = {
      id,
      title: normalized.title,
      category: normalized.category,
      priority: normalized.priority,
      summary: normalized.summary,
      details: normalized.details,
      user_message: normalized.user_message,
      status: normalized.status,
      source: normalized.source,
      submitted_at: submittedAt,
      updated_at: submittedAt,
      client: 'mr-p',
    };

    await kv.set(`feedback:${id}`, record);

    await kv.zadd('feedback:timeline', {
      score: Date.now(),
      member: JSON.stringify(record),
    });

    await kv.zadd('feedback:timeline:mr-p', {
      score: Date.now(),
      member: JSON.stringify(record),
    });

    await kv.lpush('feedback_memory', JSON.stringify(record));
    await kv.ltrim('feedback_memory', 0, 99);

    const driveFile = await writeToGoogleDrive(record);

    return res.status(200).json({
      ok: true,
      id: record.id,
      saved: true,
      driveFile,
    });
  } catch (error) {
    console.error('Feedback save error:', error);

    return res.status(500).json({
      error: 'Failed to save feedback',
      detail: error?.message || 'Unknown error',
      googleDetail: error?.response?.data || null,
    });
  }
};
