// api/feedback.js
// Stores Lana feedback in Vercel KV and sends email notifications.

const { kv } = require('@vercel/kv');

const ADMIN_EMAIL = 'fikerzabate16@gmail.com';
const DEFAULT_USER_EMAIL = 'fikerzabate162@gmail.com';
const VERIFIED_SENDER_EMAIL = 'lana@notify.lulidigital.com';
const SHARED_FROM_EMAIL = `Lana_lulidigital <${VERIFIED_SENDER_EMAIL}>`;
const SHARED_SUBJECT = 'Mrp feedback';

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

function compactText(value) {
  return String(value || '').trim();
}

function buildStructuredDetails(parsed) {
  const complaint = parsed?.complaint && typeof parsed.complaint === 'object'
    ? parsed.complaint
    : {};
  const lines = [
    `Subject: ${compactText(parsed.subject) || 'Mr P feedback'}`,
    `Agent: ${compactText(complaint.agent) || 'Not specified'}`,
    `Severity: ${compactText(complaint.severity) || 'Not specified'}`,
    `Task attempted: ${compactText(complaint.task_attempted) || 'Not specified'}`,
    `What happened: ${compactText(complaint.what_happened) || 'Not specified'}`,
    `Expected behavior: ${compactText(complaint.expected_behavior) || 'Not specified'}`,
    `Categories: ${
      Array.isArray(complaint.categories) && complaint.categories.length
        ? complaint.categories.join('; ')
        : 'general'
    }`,
    `Issues: ${
      Array.isArray(complaint.issues) && complaint.issues.length
        ? complaint.issues.join('; ')
        : 'Not specified'
    }`,
    '',
    'Latest user message',
    compactText(complaint.latest_message) || '(none)',
  ];

  if (compactText(parsed.conversation_excerpt)) {
    lines.push('', 'Conversation excerpt', compactText(parsed.conversation_excerpt));
  }

  return lines.join('\n');
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
      user_email: '',
      status: 'new',
      source: source || 'lana-chat',
    };
  }

  const isStructuredFeedbackNote = parsed.type === 'feedback_note';
  const complaint =
    parsed.complaint && typeof parsed.complaint === 'object' ? parsed.complaint : {};
  const fallbackSummary = compactText(parsed.summary) || 'General feedback';
  const fallbackDetails = isStructuredFeedbackNote
    ? buildStructuredDetails(parsed)
    : fallbackSummary;
  const fallbackUserMessage =
    compactText(parsed.user_message) ||
    compactText(complaint.latest_message) ||
    '';
  const fallbackCategory =
    typeof parsed.category === 'string' && parsed.category.trim()
      ? parsed.category.trim()
      : Array.isArray(complaint.categories) && complaint.categories.length
        ? complaint.categories[0]
        : 'general';
  const fallbackPriority =
    typeof parsed.priority === 'string' && parsed.priority.trim()
      ? parsed.priority.trim()
      : compactText(complaint.severity)
        ? complaint.severity.toLowerCase()
        : 'normal';

  return {
    title:
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : typeof parsed.subject === 'string' && parsed.subject.trim()
          ? parsed.subject.trim()
        : 'Mr P feedback',
    category:
      fallbackCategory,
    priority:
      fallbackPriority,
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallbackSummary,
    details:
      typeof parsed.details === 'string' && parsed.details.trim()
        ? parsed.details.trim()
        : fallbackDetails,
    user_message:
      fallbackUserMessage,
    user_email:
      typeof parsed.user_email === 'string' ? parsed.user_email.trim() : '',
    status:
      typeof parsed.status === 'string' && parsed.status.trim()
        ? parsed.status.trim()
        : 'new',
    source: source || 'lana-chat',
  };
}

function formatRecordText(record) {
  return [
    `Feedback ID: ${record.id}`,
    `Title: ${record.title}`,
    `Category: ${record.category}`,
    `Priority: ${record.priority}`,
    `Status: ${record.status}`,
    `Source: ${record.source}`,
    `Submitted: ${record.submitted_at}`,
    '',
    'Summary',
    record.summary,
    '',
    'Details',
    record.details,
    '',
    'User message',
    record.user_message || '(none)',
  ].join('\n');
}

async function sendEmail({ to, subject, text, from }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      skipped: true,
      reason: 'Missing RESEND_API_KEY',
    };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: from || SHARED_FROM_EMAIL,
      to: [to],
      subject,
      text,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      reason: data?.message || `Email API failed with status ${response.status}`,
      response: data,
    };
  }

  return {
    ok: true,
    skipped: false,
    id: data?.id || null,
  };
}

async function sendFeedbackNotifications(record) {
  const userEmail = record.user_email || DEFAULT_USER_EMAIL;

  const adminText = [
    'New Lana feedback received.',
    '',
    formatRecordText(record),
  ].join('\n');

  const userText = [
    'Confirmation: your feedback was received by Fiker.',
    '',
    'We will notify you once it gets fixed.',
    '',
    `Reference ID: ${record.id}`,
  ].join('\n');

  const [adminResult, userResult] = await Promise.all([
    sendEmail({
      to: ADMIN_EMAIL,
      subject: SHARED_SUBJECT,
      text: adminText,
      from: SHARED_FROM_EMAIL,
    }),
    sendEmail({
      to: userEmail,
      subject: SHARED_SUBJECT,
      text: userText,
      from: SHARED_FROM_EMAIL,
    }),
  ]);

  return {
    admin: {
      email: ADMIN_EMAIL,
      ...adminResult,
    },
    user: {
      email: userEmail,
      ...userResult,
    },
  };
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
      user_email: normalized.user_email || DEFAULT_USER_EMAIL,
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

    const notifications = await sendFeedbackNotifications(record);

    return res.status(200).json({
      ok: true,
      id: record.id,
      saved: true,
      storage: 'vercel-kv',
      notifications,
    });
  } catch (error) {
    console.error('Feedback save error:', error);

    return res.status(500).json({
      error: 'Failed to save feedback',
      detail: error && error.message ? error.message : 'Unknown error',
    });
  }
};
