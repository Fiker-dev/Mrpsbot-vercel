// api/feedback.js
// Stores Lana feedback in:
// 1) Vercel KV memory
// 2) Google Drive folder

import { kv } from '@vercel/kv';
import { google } from 'googleapis';

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
        : typeof parsed.subject === 'string' && parsed.subject.trim()
          ? parsed.subject.trim()
          : 'Mr P feedback',
    category:
      typeof parsed.category === 'string' && parsed.category.trim()
        ? parsed.category.trim()
        : Array.isArray(parsed?.complaint?.categories) && parsed.complaint.categories.length
          ? parsed.complaint.categories.join('; ')
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
        : typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : 'General feedback',
    user_message:
      typeof parsed.user_message === 'string'
        ? parsed.user_message.trim()
        : typeof parsed?.complaint?.latest_message === 'string'
          ? parsed.complaint.latest_message.trim()
          : '',
    status:
      typeof parsed.status === 'string' && parsed.status.trim()
        ? parsed.status.trim()
        : 'new',
    source: source || 'lana-chat',
  };
}

function getGoogleCredentials() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  }

  const parsed = safeJsonParse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, null);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON');
  }

  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  return parsed;
}

async function writeToGoogleDrive(record) {
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
    throw new Error('Missing GOOGLE_DRIVE_FOLDER_ID');
  }

  const credentials = getGoogleCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
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

  const filenameSafeTitle = record.title
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .
