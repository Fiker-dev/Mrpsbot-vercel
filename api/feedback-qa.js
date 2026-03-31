const { kv } = require('@vercel/kv');

const ADMIN_EMAIL = 'fikerzabate16@gmail.com';
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

function buildQaSummary(record, input) {
  return [
    `Reference ID: ${record.id}`,
    `Repro status: ${input.repro_status || 'not_provided'}`,
    `Confidence: ${input.confidence || 'not_provided'}`,
    '',
    'Reproduction steps',
    input.repro_steps || '(none)',
    '',
    'Observed result',
    input.observed_result || '(none)',
    '',
    'Expected result',
    input.expected_result || '(none)',
    '',
    'Technical evidence',
    input.technical_evidence || '(none)',
  ].join('\n');
}

function buildFixPrompt(record, qaSummary) {
  return [
    `Reference ID: ${record.id}`,
    `Target repo: ${record.repo_target || 'unknown'}`,
    `Priority: ${record.priority}`,
    '',
    record.repo_context || 'Repo context: Review the application runtime and setup before changing code.',
    '',
    record.architecture_constraints || 'Architecture constraints: Preserve existing architecture and require approval for broader changes.',
    '',
    'Developer summary',
    record.developer_summary || record.summary || '(none)',
    '',
    'Raw user quote',
    record.user_message || '(none)',
    '',
    'QA findings',
    qaSummary || '(none)',
    '',
    'Use the QA findings as the reproduction source of truth before changing code.',
  ].join('\n');
}

function applyQaOutcome(existing, input) {
  const reproStatus = text(input.repro_status);
  const qaSummary = buildQaSummary(existing, {
    repro_status: reproStatus,
    repro_steps: text(input.repro_steps),
    observed_result: text(input.observed_result),
    expected_result: text(input.expected_result),
    technical_evidence: text(input.technical_evidence),
    confidence: text(input.confidence),
  });

  let qaStatus = 'completed';
  let codingStatus = existing.coding_status || 'blocked_on_qa';
  let status = existing.status || 'new';

  if (reproStatus === 'reproduced') {
    qaStatus = 'reproduced';
    codingStatus = 'ready_for_fix';
    status = 'ready_for_fix';
  } else if (reproStatus === 'needs_clarification') {
    qaStatus = 'needs_clarification';
    codingStatus = 'blocked_on_qa';
    status = 'needs_clarification';
  } else if (reproStatus === 'not_reproduced') {
    qaStatus = 'not_reproduced';
    codingStatus = 'blocked_on_qa';
    status = 'needs_human_review';
  }

  return {
    ...existing,
    qa_status: qaStatus,
    coding_status: codingStatus,
    status,
    qa_summary: qaSummary,
    repro_status: reproStatus || existing.repro_status,
    repro_steps: text(input.repro_steps) || existing.repro_steps,
    observed_result: text(input.observed_result) || existing.observed_result,
    expected_result: text(input.expected_result) || existing.expected_result,
    technical_evidence: text(input.technical_evidence) || existing.technical_evidence,
    confidence: text(input.confidence) || existing.confidence,
    fix_prompt: buildFixPrompt(existing, qaSummary),
    updated_at: new Date().toISOString(),
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

async function sendCodingReadyNotification(record) {
  const adminText = [
    'Coding handoff is prepared.',
    '',
    `Reference ID: ${record.id}`,
    `Title: ${record.title}`,
    `Category: ${record.category}`,
    `Priority: ${record.priority}`,
    `Status: ${record.status}`,
    `Source: ${record.source}`,
    `Submitted: ${record.submitted_at}`,
    `Triage status: ${record.triage_status || 'not_generated'}`,
    `Routing: ${record.routing || 'unassigned'}`,
    `QA status: ${record.qa_status || 'not_started'}`,
    `Coding status: ${record.coding_status || 'blocked'}`,
    '',
    'Mr P said',
    record.user_message || '(none)',
  ].join('\n');

  return sendEmail({
    to: ADMIN_EMAIL,
    subject: SHARED_SUBJECT,
    text: adminText,
    from: SHARED_FROM_EMAIL,
  });
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
    const action = text(body.action) || 'start';

    if (!id) {
      return res.status(400).json({ error: 'Missing reference id' });
    }

    const existing = await kv.get(`feedback:${id}`);

    if (!existing) {
      return res.status(404).json({ error: 'Feedback record not found' });
    }

    if (action === 'start') {
      const updated = {
        ...existing,
        qa_status: 'in_progress',
        coding_status: 'blocked_on_qa',
        status: 'repro_in_progress',
        updated_at: new Date().toISOString(),
      };

      await persistRecord(updated);

      return res.status(200).json({
        ok: true,
        action: 'start',
        item: updated,
        qa_task: updated.qa_task || '',
      });
    }

    if (action === 'complete') {
      const updated = applyQaOutcome(existing, body);
      let notification = null;

      if (updated.coding_status === 'ready_for_fix') {
        notification = await sendCodingReadyNotification(updated);
        if (notification?.ok) {
          updated.coding_ready_notified_at = new Date().toISOString();
        }
      }

      await persistRecord(updated);

      return res.status(200).json({
        ok: true,
        action: 'complete',
        item: updated,
        notification,
      });
    }

    return res.status(400).json({
      error: 'Unsupported action',
      supported_actions: ['start', 'complete'],
    });
  } catch (error) {
    console.error('feedback-qa error:', error);
    return res.status(500).json({
      error: 'QA workflow failed',
      detail: error?.message || 'Unknown error',
    });
  }
};
