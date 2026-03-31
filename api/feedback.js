// api/feedback.js
// Stores Lana feedback in:
// 1) Vercel KV memory
// 2) Google Drive folder when credentials are valid

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

function parseGoogleCredentials(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return {
      credentials: null,
      detail: 'Missing GOOGLE_SERVICE_ACCOUNT_JSON',
    };
  }

  const trimmed = rawValue.trim();
  const direct = safeJsonParse(trimmed, null);
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return { credentials: direct, detail: null };
  }

  if (typeof direct === 'string') {
    const nested = safeJsonParse(direct, null);
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return { credentials: nested, detail: null };
    }
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    const base64Parsed = safeJsonParse(decoded, null);
    if (base64Parsed && typeof base64Parsed === 'object' && !Array.isArray(base64Parsed)) {
      return { credentials: base64Parsed, detail: null };
    }
  } catch {
    // Ignore base64 decode errors and fall through to the explicit detail below.
  }

  return {
    credentials: null,
    detail: 'Invalid GOOGLE_SERVICE_ACCOUNT_JSON',
  };
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
      typeof parsed.user_message === 'string' ? parsed.user_message.trim() : '',
    status:
      typeof parsed.status === 'string' && parsed.status.trim()
        ? parsed.status.trim()
        : 'new',
    source: source || 'lana-chat',
  };
}

async function writeToGoogleDrive(record) {
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
    throw new Error('Missing GOOGLE_DRIVE_FOLDER_ID');
  }

  const { credentials, detail } = parseGoogleCredentials(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  );

  if (!credentials) {
    throw new Error(detail || 'Invalid GOOGLE_SERVICE_ACCOUNT_JSON');
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

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      mimeType: 'text/plain',
    },
    media: {
      mimeType: 'text/plain',
      body: driveBody,
    },
    fields: 'id,name,webViewLink',
  });

  return response.data;
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
      globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `fb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();

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
      score: now,
      member: JSON.stringify(record),
    });
    await kv.zadd('feedback:timeline:mr-p', {
      score: now,
      member: JSON.stringify(record),
    });
    await kv.lpush('feedback_memory', JSON.stringify(record));
    await kv.ltrim('feedback_memory', 0, 99);

    let driveSaved = false;
    let driveFile = null;
    let driveError = null;

    try {
      driveFile = await writeToGoogleDrive(record);
      driveSaved = true;
    } catch (error) {
      driveError = error && error.message ? error.message : 'Unknown Google Drive error';
      console.error('Feedback drive write failed:', {
        id,
        detail: driveError,
      });
    }

    return res.status(200).json({
      ok: true,
      id: record.id,
      saved: true,
      driveSaved,
      driveFile,
      driveError,
    });
  } catch (error) {
    console.error('Feedback save error:', error);

    return res.status(500).json({
      error: 'Failed to save feedback',
      detail: error && error.message ? error.message : 'Unknown error',
    });
  }
};
