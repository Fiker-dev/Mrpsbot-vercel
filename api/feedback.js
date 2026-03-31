// api/feedback.js
// Stores Lana feedback in Vercel KV.

const { kv } = require('@vercel/kv');

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
      typeof parsed.user_message === 'string' ? parsed.user_message.trim() : '',
    status:
      typeof parsed.status === 'string' && parsed.status.trim()
        ? parsed.status.trim()
        : 'new',
    source: source || 'lana-chat',
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

    return res.status(200).json({
      ok: true,
      id: record.id,
      saved: true,
      storage: 'vercel-kv',
    });
  } catch (error) {
    console.error('Feedback save error:', error);

    return res.status(500).json({
      error: 'Failed to save feedback',
      detail: error && error.message ? error.message : 'Unknown error',
    });
  }
};
