// api/chat.js
// Lily feedback assistant for Mr P
// - keeps the conversation natural
// - asks at most one useful clarification in most cases
// - immediately passes feedback on when the user says to send/pass/tell Fiker
// - returns structured feedback payload when done=true

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const rawMessage = typeof body.message === 'string' ? body.message : '';
    const history = Array.isArray(body.history) ? body.history : [];
    const clientId = typeof body.clientId === 'string' && body.clientId.trim()
      ? body.clientId.trim()
      : 'mr-p';

    const message = rawMessage.trim();

    if (!message) {
      return res.status(400).json({ error: 'No message provided' });
    }

    const lower = normalize(message);

    const historyText = history
      .map((m) => `${m?.role || 'unknown'}: ${typeof m?.text === 'string' ? m.text : ''}`)
      .join('\n');

    const historyLower = normalize(historyText);

    const combinedLower = `${historyLower}\n${lower}`.trim();

    const complaint = extractComplaint(message, combinedLower);
    const hasEnoughComplaint = Boolean(
      complaint.agent || complaint.issues.length || complaint.summaryBits.length
    );

    // Hard submit triggers: user clearly wants it passed on now
    if (isImmediateSubmit(lower)) {
      const summary = buildFeedbackSummary({
        clientId,
        complaint,
        historyText,
        latestMessage: message,
        userRequestedImmediatePass: true,
      });

      return res.status(200).json({
        reply: "Understood, Mr P. I’ll pass that to Fiker now.",
        done: true,
        feedback: summary,
      });
    }

    // If user directly reports an issue and it is already clear enough,
    // ask only one concise follow-up OR offer to pass it on.
    if (hasEnoughComplaint) {
      const clarificationCount = countAssistantClarifications(history);

      // If we already asked enough questions, stop drilling and offer/pass forward
      if (clarificationCount >= 2) {
        const summary = buildFeedbackSummary({
          clientId,
          complaint,
          historyText,
          latestMessage: message,
          userRequestedImmediatePass: false,
        });

        return res.status(200).json({
          reply: "Understood, Mr P. I have enough to pass this to Fiker. Would you like me to send it now?",
          done: false,
          feedback_preview: summary.summary,
        });
      }

      // If the complaint is clear and concrete, ask at most one useful question
      if (complaint.agent === 'Chanelle' && includesAny(lower, ['slow', 'speed', 'long', 'respond', 'response', 'doesnt make sense', "doesn't make sense", 'confusing', 'unclear'])) {
        if (clarificationCount === 0) {
          return res.status(200).json({
            reply: "Understood, Mr P. I have that Chanelle feels slow and some replies do not make sense. Would you like me to pass that to Fiker now, or is there one more detail you want to add?",
            done: false,
          });
        }

        const summary = buildFeedbackSummary({
          clientId,
          complaint,
          historyText,
          latestMessage: message,
          userRequestedImmediatePass: false,
        });

        return res.status(200).json({
          reply: "Understood, Mr P. I can pass that to Fiker now.",
          done: false,
          feedback_preview: summary.summary,
        });
      }

      // General complaint path
      if (clarificationCount === 0 && needsOneClarification(complaint, lower)) {
        return res.status(200).json({
          reply: makeSingleClarificationQuestion(complaint),
          done: false,
        });
      }

      const summary = buildFeedbackSummary({
        clientId,
        complaint,
        historyText,
        latestMessage: message,
        userRequestedImmediatePass: false,
      });

      return res.status(200).json({
        reply: "Understood, Mr P. I have enough to pass this to Fiker. Would you like me to send it now?",
        done: false,
        feedback_preview: summary.summary,
      });
    }

    // Very short / vague messages
    if (isGreetingOnly(lower)) {
      return res.status(200).json({
        reply: "Hello, Mr P. What would you like me to pass on or help clarify today?",
        done: false,
      });
    }

    return res.status(200).json({
      reply: "I’m here to help, Mr P. What seems to be the main issue, or what would you like me to pass on to Fiker?",
      done: false,
    });
  } catch (err) {
    console.error('chat.js error:', err);
    return res.status(500).json({
      error: 'Server error',
      reply: 'Something went wrong on my side. Please try again in a moment.',
    });
  }
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function isGreetingOnly(lower) {
  const greetings = [
    'hi',
    'hello',
    'hey',
    'good morning',
    'good afternoon',
    'good evening',
  ];
  return greetings.includes(lower);
}

function isImmediateSubmit(lower) {
  const submitTriggers = [
    'just tell fiker',
    'tell fiker',
    'pass it to fiker',
    'pass this to fiker',
    'just pass it to fiker',
    'just pass my complaint to fiker',
    'just tell what i said to fiker',
    'just tell what i said to fiker thats all',
    "just tell what i said to fiker that's all",
    'thats all',
    "that's all",
    'send it',
    'send this',
    'log it',
    'submit it',
    'pass it on',
    'just pass it on',
    'no more',
    'that is all',
    'thats enough',
    "that's enough",
  ];

  return submitTriggers.some((phrase) => lower.includes(phrase));
}

function countAssistantClarifications(history) {
  let count = 0;
  for (const item of history) {
    if (!item || item.role !== 'assistant' || typeof item.text !== 'string') continue;
    const text = normalize(item.text);
    if (
      text.includes('would you like me to pass that to fiker now') ||
      text.includes('what seems to be the main issue') ||
      text.includes('is there one more detail you want to add') ||
      text.includes('do you mean') ||
      text.includes('what part') ||
      text.includes('what feels most') ||
      text.includes('what would you like me to pass on')
    ) {
      count += 1;
    }
  }
  return count;
}

function extractComplaint(message, combinedLower) {
  const lower = normalize(message);

  let agent = '';
  if (includesAny(combinedLower, ['chanelle'])) agent = 'Chanelle';
  else if (includesAny(combinedLower, ['sofie'])) agent = 'Sofie';
  else if (includesAny(combinedLower, ['mimi'])) agent = 'Mimi';
  else if (includesAny(combinedLower, ['lily'])) agent = 'Lily';
  else if (includesAny(combinedLower, ['agent', 'agents'])) agent = 'agents';

  const issues = [];
  const summaryBits = [];

  if (includesAny(combinedLower, ['slow', 'takes too long', 'long to respond', 'speed', 'waiting', 'delay', 'delayed'])) {
    issues.push('slow response time');
    summaryBits.push('response time feels too slow');
  }

  if (includesAny(combinedLower, ['doesnt make sense', "doesn't make sense", 'confusing', 'unclear', 'not clear'])) {
    issues.push('unclear responses');
    summaryBits.push('some responses do not make sense or feel unclear');
  }

  if (includesAny(combinedLower, ['bug', 'broken', 'not working', 'issue', 'problem', 'fails', 'error'])) {
    issues.push('general functionality issue');
    summaryBits.push('there may be a functionality issue');
  }

  if (includesAny(combinedLower, ['missing', 'not there', 'wish', 'should do', 'feature'])) {
    issues.push('missing capability or requested improvement');
    summaryBits.push('there may be something missing or needing improvement');
  }

  const cleanedMessage = String(message || '').trim();
  if (cleanedMessage) {
    summaryBits.push(`latest user wording: "${cleanedMessage}"`);
  }

  return {
    agent,
    issues: unique(issues),
    summaryBits: unique(summaryBits),
  };
}

function needsOneClarification(complaint, lower) {
  // Ask one clarification only when too vague
  if (!complaint.agent && complaint.issues.length === 0) return true;
  if (complaint.agent && complaint.issues.length === 0 && !includesAny(lower, ['pass', 'tell fiker', 'send'])) return true;
  return false;
}

function makeSingleClarificationQuestion(complaint) {
  if (complaint.agent) {
    return `I understand, Mr P. What seems to be the main issue with ${complaint.agent}?`;
  }
  return "I understand, Mr P. What seems to be the main issue, and which agent is it about?";
}

function unique(items) {
  return [...new Set(items)];
}

function buildFeedbackSummary({
  clientId,
  complaint,
  historyText,
  latestMessage,
  userRequestedImmediatePass,
}) {
  const issueText = complaint.issues.length
    ? complaint.issues.join('; ')
    : 'general complaint or feedback';

  const aboutText = complaint.agent
    ? `about ${complaint.agent}`
    : 'about the assistant workflow';

  const summary = [
    `Feedback for Fiker from Mr P ${aboutText}.`,
    `Main issue: ${issueText}.`,
    complaint.summaryBits.length ? `Details: ${complaint.summaryBits.join('; ')}.` : '',
    userRequestedImmediatePass ? 'The user explicitly asked for this to be passed on without further back-and-forth.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    type: 'feedback_note',
    client_id: clientId,
    subject: complaint.agent
      ? `Feedback from Mr P about ${complaint.agent}`
      : 'Feedback from Mr P',
    summary,
    complaint: {
      agent: complaint.agent || null,
      issues: complaint.issues,
      latest_message: latestMessage,
      user_requested_immediate_pass: userRequestedImmediatePass,
    },
    conversation_excerpt: historyText,
    created_at: new Date().toISOString(),
  };
}
