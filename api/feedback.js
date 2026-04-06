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

function buildFallbackDeveloperSummary(record) {
  return [
    `Title: ${record.title}`,
    `Reference ID: ${record.id}`,
    `Priority: ${record.priority}`,
    `Category: ${record.category}`,
    `Source: ${record.source}`,
    '',
    'Observed behavior',
    record.summary || record.details || 'Not specified',
    '',
    'Raw user quote',
    record.user_message || '(none)',
    '',
    'Next step',
    'Review the raw user quote and reproduce the issue before assigning it to a coding agent.',
  ].join('\n');
}

function inferWorkflowRoute(record) {
  const text = `${record.title}\n${record.summary}\n${record.details}\n${record.user_message}`.toLowerCase();
  const isLikelyTextOnly =
    record.category === 'ui/ux' ||
    /\btypo\b|\bwording\b|\bcopy\b|\blabel\b|\bbutton text\b/.test(text);
  const hasCrashOrRuntimeSignal =
    /\bcrash\b|\berror\b|\bexception\b|\btraceback\b|\bconfigerror\b|\bfailed\b|\bnot working\b|\bstartup\b/.test(text);

  if (isLikelyTextOnly && !hasCrashOrRuntimeSignal) {
    return 'coding';
  }

  return 'qa';
}

function buildRepoContext(repoTarget) {
  if (repoTarget === 'chanelle-legal-assistant') {
    return [
      'Repo context:',
      '- Local FastAPI legal assistant app.',
      '- Main entrypoint is app.py.',
      '- Start command: uvicorn app:app --reload --host 0.0.0.0 --port 8000.',
      '- Uses Ollama locally with llama3.1 and nomic-embed-text.',
      '- Frontend is vanilla HTML/CSS/JS.',
      '- Tests: pytest tests/test_docs.py -v.',
      '- Known real-world failure already seen: startup crash on Python 3.14 involving chromadb / pydantic.v1 ConfigError about chroma_server_nofile.',
    ].join('\n');
  }

  if (repoTarget === 'mrpsagentguide') {
    return [
      'Repo context:',
      '- Frontend guide site hosting Lana widget.',
      '- Primary concern is widget UX, wording, submission flow, and browser-side integration with mrpsbot-vercel.',
    ].join('\n');
  }

  return [
    'Repo context:',
    '- Review the repository structure and runtime before testing.',
  ].join('\n');
}

function buildArchitectureConstraints(repoTarget) {
  if (repoTarget === 'chanelle-legal-assistant') {
    return [
      'Architecture constraints:',
      '- Preserve the core Sofie -> Mimi -> Chanelle research flow unless the fix explicitly targets that orchestration.',
      '- Treat app.py as a monolithic backend; avoid broad refactors unless explicitly approved.',
      '- Do not casually alter Azure AD / Microsoft Graph auth behavior.',
      '- Do not casually change document ingestion, SQLite persistence, or the in-memory vector store design.',
      '- Maintain vanilla frontend behavior and avoid introducing a new framework or build step.',
      '- Respect existing QA guardrails in CLAUDE.md, especially conversation routing, voice behavior, and security-sensitive flows.',
      '- If the requested work sounds like a feature or architecture change rather than a bug fix, stop and ask for approval.',
    ].join('\n');
  }

  if (repoTarget === 'mrpsagentguide') {
    return [
      'Architecture constraints:',
      '- Preserve the current Lana widget integration with mrpsbot-vercel.',
      '- Avoid changing submission flow semantics without explicit approval.',
      '- Treat feature requests separately from bug fixes and require approval before implementing net-new behavior.',
    ].join('\n');
  }

  return [
    'Architecture constraints:',
    '- Preserve existing architecture and patterns unless explicit approval is provided for broader changes.',
  ].join('\n');
}

function buildQaTask(record) {
  return [
    `Reference ID: ${record.id}`,
    `Target repo: ${record.repo_target || 'unknown'}`,
    `Priority: ${record.priority}`,
    '',
    record.repo_context || buildRepoContext(record.repo_target),
    '',
    'Goal',
    'Reproduce the reported issue and collect concrete evidence before handing it to a coding agent.',
    '',
    'Developer summary',
    record.developer_summary || record.summary || '(none)',
    '',
    'Mr P said',
    record.user_message || '(none)',
    '',
    'Required output',
    '- repro_status',
    '- repro_steps',
    '- observed_result',
    '- expected_result',
    '- technical_evidence',
    '- confidence',
    '- recommended next action',
  ].join('\n');
}

function buildCodingPrompt(record) {
  return [
    `Reference ID: ${record.id}`,
    `Target repo: ${record.repo_target || 'unknown'}`,
    `Priority: ${record.priority}`,
    '',
    record.repo_context || buildRepoContext(record.repo_target),
    '',
    record.architecture_constraints || buildArchitectureConstraints(record.repo_target),
    '',
    'Use this developer summary as the primary fix brief:',
    record.developer_summary || record.summary || '(none)',
    '',
    'Raw user quote',
    record.user_message || '(none)',
    '',
    'If QA evidence exists, use it as authoritative reproduction context before making code changes.',
  ].join('\n');
}

function extractAnthropicText(data) {
  if (!data || !Array.isArray(data.content)) return '';

  return data.content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

async function generateDeveloperSummary(record) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      text: buildFallbackDeveloperSummary(record),
      status: 'fallback_missing_api_key',
    };
  }

  const model = process.env.CLAUDE_TRIAGE_MODEL || 'claude-sonnet-4-20250514';
  const system = [
    'You are an internal software triage agent.',
    'Turn user feedback into a concise developer handoff.',
    'Do not rewrite away the raw user complaint.',
    'Output plain text only.',
    'Use these sections exactly: Title, Product area, Severity, Observed behavior, Expected behavior, Reproduction notes, Technical clues, Raw user quote, Recommended next step.',
    'Be concrete and preserve specific errors, stack clues, versions, and user intent.',
  ].join(' ');
  const prompt = [
    `Reference ID: ${record.id}`,
    `Title: ${record.title}`,
    `Category: ${record.category}`,
    `Priority: ${record.priority}`,
    `Source: ${record.source}`,
    '',
    'Summary',
    record.summary || '(none)',
    '',
    'Details',
    record.details || '(none)',
    '',
    'Raw user quote',
    record.user_message || '(none)',
  ].join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      system,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  const text = extractAnthropicText(data);

  if (!response.ok || !text) {
    return {
      text: buildFallbackDeveloperSummary(record),
      status: response.ok ? 'fallback_empty_model_response' : 'fallback_model_error',
      error: data?.error?.message || data?.message || `Claude API failed with status ${response.status}`,
    };
  }

  return {
    text,
    status: 'generated',
    model,
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
    'New Lana feedback received.',
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
  const adminText = formatRecordText(record);
  const isRepeat = /\bagain\b|\bstill\b|\brepeat(?:ed)?\b/i.test(`${record.summary}\n${record.details}\n${record.user_message}`);
  const userSubject = isRepeat
    ? "Lana update: I've submitted this again for another look"
    : "Lana update: I've submitted your feedback";
  const userIntro = isRepeat
    ? "Lana here. I noticed this has happened again, so I've sent it back for another look."
    : "Lana here. I've submitted your feedback.";

  const userText = [
    userIntro,
    '',
    'Feedback received:',
    `"${record.user_message || record.summary}"`,
    '',
    `Reference ID: ${record.id}`,
    "We will notify you once it's fixed.",
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
      subject: userSubject,
      text: userText,
      from: SHARED_FROM_EMAIL,
    }),
  ]);

  return {
    admin: {
      email: ADMIN_EMAIL,
      subject: SHARED_SUBJECT,
      preview: adminText.split('\n')[0],
      ...adminResult,
    },
    user: {
      email: userEmail,
      subject: userSubject,
      preview: userText.split('\n')[0],
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

    const developerSummary = await generateDeveloperSummary(record);

    record.developer_summary = developerSummary.text;
    record.triage_status = developerSummary.status;
    if (developerSummary.model) {
      record.triage_model = developerSummary.model;
    }
    if (developerSummary.error) {
      record.triage_error = developerSummary.error;
    }
    record.routing = inferWorkflowRoute(record);
    record.qa_status = record.routing === 'qa' ? 'pending' : 'not_required';
    record.coding_status = record.routing === 'coding' ? 'ready_for_fix' : 'blocked_on_qa';
    record.repo_target = record.category === 'agent behavior'
      ? 'chanelle-legal-assistant'
      : 'mrpsagentguide';
    record.repo_context = buildRepoContext(record.repo_target);
    record.architecture_constraints = buildArchitectureConstraints(record.repo_target);
    record.qa_task = buildQaTask(record);
    record.fix_prompt = buildCodingPrompt(record);

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
