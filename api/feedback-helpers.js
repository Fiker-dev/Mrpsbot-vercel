import { createHash } from 'node:crypto';

const LOCATION_HINTS = [
  'chanelle',
  'sofie',
  'mimi',
  'lana',
  'guide',
  'page',
  'workflow',
  'handoff',
  'chat',
  'feedback',
  'validation',
  'research',
  'delivery',
  'capability',
  'agent',
];

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'fikerzabate16@gmail.com';
const DEFAULT_USER_EMAIL = process.env.DEFAULT_USER_EMAIL || 'fikerzabate162@gmail.com';
const VERIFIED_SENDER_EMAIL = process.env.VERIFIED_SENDER_EMAIL || 'lana@notify.lulidigital.com';
const SHARED_FROM_EMAIL = process.env.SHARED_FROM_EMAIL || `Lana_lulidigital <${VERIFIED_SENDER_EMAIL}>`;
const SHARED_SUBJECT = process.env.FEEDBACK_EMAIL_SUBJECT || 'Mr P feedback';

const QA_HINTS = [
  'hallucinat',
  'wrong',
  'incorrect',
  'inaccurate',
  'bug',
  'broken',
  'not working',
  'confusing',
  'unclear',
  'validation',
  'quality',
  'reliability',
  'inconsistent',
  'duplicate',
  'repeat',
];

const CODING_HINTS = [
  'add',
  'build',
  'create',
  'change',
  'feature',
  'button',
  'ui',
  'route',
  'notification',
  'storage',
  'email',
];

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'but', 'by', 'for', 'from',
  'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on',
  'or', 'so', 'still', 'that', 'the', 'this', 'to', 'was', 'with', 'you', 'your',
  'again', 'there', 'here', 'they', 'them', 'what', 'when', 'where', 'which',
]);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function getErrorMessage(error) {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  return 'Unknown error';
}

function hasWords(text, minWords) {
  return cleanText(text).split(' ').filter(Boolean).length >= minWords;
}

function hasLocationSignal(text) {
  const lower = cleanText(text).toLowerCase();
  return LOCATION_HINTS.some((hint) => lower.includes(hint));
}

function includesAny(text, hints) {
  return hints.some((hint) => text.includes(hint));
}

export function formatFeedbackReference(id) {
  const compact = cleanText(id).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return `MRP-${compact.slice(0, 8) || 'UNKNOWN'}`;
}

export function buildSubmissionFingerprint({ raw_feedback, email, source }) {
  const payload = JSON.stringify({
    raw_feedback: cleanText(raw_feedback).toLowerCase(),
    email: cleanText(email).toLowerCase(),
    source: cleanText(source).toLowerCase(),
  });
  return createHash('sha256').update(payload).digest('hex');
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && token.length > 2 && !STOP_WORDS.has(token));
}

function toStemSet(value) {
  return new Set(
    tokenize(value).map((token) => token.slice(0, 6))
  );
}

function scoreTokenOverlap(a, b) {
  const aTokens = new Set([...tokenize(a), ...toStemSet(a)]);
  const bTokens = new Set([...tokenize(b), ...toStemSet(b)]);

  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
}

function normalizeStoredItem(item) {
  if (!item || typeof item !== 'object') return null;

  const parsedRepeatCount = Number(item.repeat_count);

  return {
    id: item.id || null,
    reference_number: item.reference_number || null,
    status: cleanText(item.status || 'pending').toLowerCase(),
    repeat_count: Number.isFinite(parsedRepeatCount) && parsedRepeatCount > 0 ? parsedRepeatCount : 1,
    summary: cleanText(item.summary),
    issue: cleanText(item.issue),
    fixed_note: cleanText(item.fixed_note),
    fixed_at: item.fixed_at || null,
    source_text: cleanText(item.raw_feedback || item.issue || item.summary),
  };
}

export function detectRepeatIssue(message, feedbackItems = [], resolvedItems = []) {
  const sourceText = cleanText(message);

  if (!sourceText) {
    return {
      repeated: false,
      recently_fixed: false,
      still_happening_after_fix: false,
      hint: null,
      match: null,
    };
  }

  const feedbackMatches = (feedbackItems || [])
    .map(normalizeStoredItem)
    .filter(Boolean)
    .map((item) => ({
      ...item,
      score: scoreTokenOverlap(sourceText, `${item.source_text} ${item.summary} ${item.issue}`),
      source: 'feedback_memory',
    }))
    .filter((item) => item.score >= 0.25)
    .sort((a, b) => b.score - a.score);

  const resolvedMatches = (resolvedItems || [])
    .map(normalizeStoredItem)
    .filter(Boolean)
    .map((item) => ({
      ...item,
      score: scoreTokenOverlap(sourceText, `${item.source_text} ${item.summary} ${item.issue} ${item.fixed_note}`),
      source: 'resolved_updates',
    }))
    .filter((item) => item.score >= 0.25)
    .sort((a, b) => b.score - a.score);

  const bestFeedback = feedbackMatches[0] || null;
  const bestResolved = resolvedMatches[0] || null;

  if (bestResolved && (!bestFeedback || bestResolved.score >= bestFeedback.score)) {
    return {
      repeated: true,
      recently_fixed: true,
      still_happening_after_fix: true,
      repeat_type: 'reopened_after_fix',
      hint: 'recently fixed but may still be happening',
      match: {
        id: bestResolved.id,
        reference_number: bestResolved.reference_number,
        repeat_count: bestResolved.repeat_count,
        summary: bestResolved.summary,
        fixed_note: bestResolved.fixed_note,
        fixed_at: bestResolved.fixed_at,
        status: bestResolved.status || 'fixed',
      },
    };
  }

  if (bestFeedback) {
    return {
      repeated: true,
      recently_fixed: false,
      still_happening_after_fix: false,
      repeat_type: 'pending_repeat',
      hint: 'already raised and not yet marked fixed',
      match: {
        id: bestFeedback.id,
        reference_number: bestFeedback.reference_number,
        repeat_count: bestFeedback.repeat_count,
        summary: bestFeedback.summary,
        fixed_note: '',
        fixed_at: null,
        status: bestFeedback.status || 'pending',
      },
    };
  }

  return {
    repeated: false,
    recently_fixed: false,
    still_happening_after_fix: false,
    repeat_type: null,
    hint: null,
    match: null,
  };
}

export function validateFeedbackDraft(rawMessage, feedback) {
  if (!feedback || typeof feedback !== 'object') {
    return {
      ok: false,
      reason: 'missing_feedback',
      followUp: 'What felt wrong, and where did it show up for you, Mr P?',
    };
  }

  const summary = cleanText(feedback.summary);
  const area = cleanText(feedback.area);
  const issue = cleanText(feedback.issue);
  const suggestedChange = cleanText(feedback.suggested_change);
  const raw = cleanText(rawMessage);
  const hasSubstance = summary.length >= 8 && (issue.length >= 14 || suggestedChange.length >= 14 || hasWords(issue, 4));
  const hasLocationInUserText = hasLocationSignal(raw);
  const areaLooksSpecific = area.length >= 3 && area.toLowerCase() !== 'general' && hasLocationSignal(area);
  const summaryLooksSpecific = hasLocationSignal(summary);
  const hasLocation = hasLocationInUserText;

  if (!hasSubstance && !hasLocation) {
    return {
      ok: false,
      reason: 'missing_substance_and_location',
      followUp: 'What exactly felt wrong, and was it with Chanelle, Sofie, Mimi, Lana, or the guide page itself?',
    };
  }

  if (!hasSubstance) {
    return {
      ok: false,
      reason: 'missing_substance',
      followUp: 'What exactly felt wrong there, Mr P?',
    };
  }

  if (!hasLocation) {
    return {
      ok: false,
      reason: 'missing_location',
      followUp:
        areaLooksSpecific || summaryLooksSpecific
          ? 'Just to pin it down properly, where did that show up for you, Mr P? Was it with an agent, a handoff, or the guide page itself?'
          : 'Where did that show up for you, Mr P. Was it with an agent, a handoff, or the guide page itself?',
    };
  }

  return {
    ok: true,
    normalized: {
      summary,
      area: area || 'General',
      issue,
      suggested_change: suggestedChange,
    },
  };
}

export function determineFeedbackRoute(feedback) {
  const summary = cleanText(feedback.summary).toLowerCase();
  const issue = cleanText(feedback.issue).toLowerCase();
  const suggestedChange = cleanText(feedback.suggested_change).toLowerCase();
  const rawFeedback = cleanText(feedback.raw_feedback).toLowerCase();
  const haystack = cleanText([
    feedback.summary,
    feedback.area,
    feedback.issue,
    feedback.suggested_change,
    feedback.raw_feedback,
  ].join(' ')).toLowerCase();
  const qaSignal = includesAny(haystack, QA_HINTS);
  const codingSignal = includesAny(`${suggestedChange} ${issue}`, CODING_HINTS);
  const explicitChangeRequest =
    suggestedChange.length > 0 ||
    includesAny(rawFeedback, ['please add', 'please change', 'please update', 'please improve', 'can you add', 'i want', 'needs to']) ||
    includesAny(summary, ['add', 'change', 'feature']);

  // Quality issues should default to QA unless the user clearly asked for an implementation change.
  if (qaSignal && !explicitChangeRequest) {
    return {
      team: 'qa',
      reason: 'quality_or_accuracy_review',
    };
  }

  if (codingSignal || explicitChangeRequest) {
    return {
      team: 'coding',
      reason: 'product_or_implementation_change',
    };
  }

  if (qaSignal) {
    return {
      team: 'qa',
      reason: 'quality_or_accuracy_review',
    };
  }

  return {
    team: 'qa',
    reason: 'default_review_gate',
  };
}

export function buildSubmittedNotifications(record) {
  return [
    {
      event: 'feedback_submitted',
      recipient: 'internal',
      reference: record.reference_number,
      feedback_id: record.id,
      route_to: record.route_to,
      route_reason: record.route_reason,
      message: [
        `Feedback submitted: ${record.reference_number}`,
        `Route: ${record.route_to} (${record.route_reason})`,
        `Source: ${record.source}`,
        `Summary: ${record.summary}`,
        `Area: ${record.area}`,
        `Issue: ${record.issue}`,
        `Suggested change: ${record.suggested_change || 'None stated'}`,
        `Raw feedback: ${record.raw_feedback}`,
      ].join('\n'),
      created_at: record.created_at,
    },
    {
      event: 'feedback_submitted',
      recipient: 'user',
      reference: record.reference_number,
      feedback_id: record.id,
      message: `Your feedback has been submitted.\n\n"${record.raw_feedback}"`,
      created_at: record.created_at,
    },
  ];
}

export function buildFixedNotifications(record) {
  return [
    {
      event: 'feedback_fixed',
      recipient: 'internal',
      reference: record.reference_number,
      feedback_id: record.id,
      message: [
        `Feedback fixed: ${record.reference_number}`,
        `Resolved by: ${record.resolved_by || 'dev-agent'}`,
        `Fix note: ${cleanText(record.fixed_note) || 'No fix note provided'}`,
      ].join('\n'),
      created_at: record.updated_at,
    },
    {
      event: 'feedback_fixed',
      recipient: 'user',
      reference: record.reference_number,
      feedback_id: record.id,
      message: `Reference ${record.reference_number} has been fixed.`,
      created_at: record.updated_at,
    },
  ];
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

export async function sendSubmittedEmails(record) {
  const userEmail = cleanText(record.email) || DEFAULT_USER_EMAIL;

  const adminText = [
    `New Mr P feedback submitted: ${record.reference_number}`,
    '',
    `Route: ${record.route_to} (${record.route_reason})`,
    `Source: ${record.source}`,
    `Summary: ${record.summary}`,
    `Area: ${record.area}`,
    `Issue: ${record.issue}`,
    `Suggested change: ${record.suggested_change || 'None stated'}`,
    '',
    'Raw feedback',
    record.raw_feedback || '(none)',
  ].join('\n');

  const quotedFeedback = record.raw_feedback || record.summary;
  const userIntro =
    record.repeat_type === 'reopened_after_fix'
      ? "Lana here. I noticed this has happened again, so I've sent it back for another look."
      : record.repeat_type === 'pending_repeat'
        ? "Lana here. I can see you're still having trouble with this, so I've submitted it again."
        : "Lana here. I've submitted your feedback.";
  const userSubject =
    record.repeat_type === 'reopened_after_fix' || record.repeat_type === 'pending_repeat'
      ? "Lana update: I've submitted this again for another look"
      : "Lana update: I've submitted your feedback";

  const userText = [
    userIntro,
    '',
    'Feedback received:',
    `"${quotedFeedback}"`,
    '',
    `Reference number: ${record.reference_number}`,
    "We will notify you once it's fixed.",
  ].join('\n');

  const [adminResult, userResult] = await Promise.all([
    sendEmail({
      to: ADMIN_EMAIL,
      subject: SHARED_SUBJECT,
      text: adminText,
    }),
    sendEmail({
      to: userEmail,
      subject: userSubject,
      text: userText,
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

export async function sendFixedEmails(record) {
  const userEmail = cleanText(record.email) || DEFAULT_USER_EMAIL;

  const adminText = [
    `Feedback fixed: ${record.reference_number}`,
    '',
    `Resolved by: ${record.resolved_by || 'dev-agent'}`,
    `Summary: ${record.summary}`,
    `Fix note: ${cleanText(record.fixed_note) || 'No fix note provided'}`,
  ].join('\n');

  const userText = [
    `Your feedback "${record.raw_feedback || record.summary}" has now been fixed.`,
    '',
    `Reference number: ${record.reference_number}`,
    cleanText(record.fixed_note) || 'The issue has been addressed.',
    '',
    'Please try again.',
    "And don't hesitate to submit another feedback note if anything still feels off.",
  ].join('\n');

  const [adminResult, userResult] = await Promise.all([
    sendEmail({
      to: ADMIN_EMAIL,
      subject: SHARED_SUBJECT,
      text: adminText,
    }),
    sendEmail({
      to: userEmail,
      subject: SHARED_SUBJECT,
      text: userText,
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
      subject: SHARED_SUBJECT,
      preview: userText.split('\n')[0],
      ...userResult,
    },
  };
}
