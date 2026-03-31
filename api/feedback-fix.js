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

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function sendEmail({ to, subject, text: bodyText, from }) {
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
      text: bodyText,
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

async function persistRecord(record) {
  await kv.set(`feedback:${record.id}`, record);
  await kv.zadd('feedback:timeline', {
    score: Date.now(),
    member: JSON.stringify(record),
  });
  await kv.zadd(`feedback:timeline:${record.client || 'mr-p'}`, {
    score: Date.now(),
    member: JSON.stringify(record),
  });
  await kv.lpush('feedback_memory', JSON.stringify(record));
  await kv.ltrim('feedback_memory', 0, 99);
}

async function sendFixNotifications(record) {
  const userEmail = record.user_email || DEFAULT_USER_EMAIL;
  const userText = [
    `Your feedback, Reference ID "${record.id}", has been fixed.`,
    '',
    'What was fixed:',
    record.fix_summary || '(No fix summary provided)',
    '',
    'Thank you for helping improve the app.',
  ].join('\n');

  const adminText = [
    `Reference ID "${record.id}" has been marked fixed.`,
    '',
    'Fix summary',
    record.fix_summary || '(none)',
    '',
    `Repo target: ${record.repo_target || 'unknown'}`,
    `PR URL: ${record.pr_url || '(none)'}`,
    `Commit SHA: ${record.commit_sha || '(none)'}`,
    `Deployment URL: ${record.deployment_url || '(none)'}`,
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

  try {
    const body = req.body || {};
    const id = text(body.id);
    const fixSummary = text(body.fix_summary);

    if (!id) {
      return res.status(400).json({ error: 'Missing reference id' });
    }

    if (!fixSummary) {
      return res.status(400).json({ error: 'Missing fix summary' });
    }

    const existing = await kv.get(`feedback:${id}`);

    if (!existing) {
      return res.status(404).json({ error: 'Feedback record not found' });
    }

    const fixedAt = new Date().toISOString();
    const updated = {
      ...existing,
      status: 'fixed',
      coding_status: 'fixed',
      fix_summary: fixSummary,
      pr_url: text(body.pr_url) || existing.pr_url,
      commit_sha: text(body.commit_sha) || existing.commit_sha,
      deployment_url: text(body.deployment_url) || existing.deployment_url,
      fixed_at: fixedAt,
      updated_at: fixedAt,
    };

    const notifications = await sendFixNotifications(updated);
    updated.user_notified_at = notifications.user.ok ? fixedAt : existing.user_notified_at;
    updated.admin_fixed_notified_at = notifications.admin.ok ? fixedAt : existing.admin_fixed_notified_at;

    await persistRecord(updated);

    return res.status(200).json({
      ok: true,
      item: updated,
      notifications,
    });
  } catch (error) {
    console.error('feedback-fix error:', error);
    return res.status(500).json({
      error: 'Fix workflow failed',
      detail: error?.message || 'Unknown error',
    });
  }
};
