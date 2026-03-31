// api/chat.js
// Lana feedback assistant for Mr P
// Purpose:
// - help Mr P give clear, useful feedback about his private legal assistant app
// - not act as the legal assistant itself
// - not give legal advice
// - ask concise follow-up questions only when needed
// - stop and submit immediately when Mr P says to pass it on
// - respond naturally to greetings and small talk before moving into feedback mode

module.exports = async function handler(req, res) {
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
    const clientId =
      typeof body.clientId === 'string' && body.clientId.trim()
        ? body.clientId.trim()
        : 'mr-p';

    const message = rawMessage.trim();

    if (!message) {
      return res.status(400).json({ error: 'No message provided' });
    }

    const lower = normalize(message);
    const userHistoryText = getUserHistoryText(history);
    const userHistoryLower = normalize(userHistoryText);
    const userConversationLower = [userHistoryLower, lower].filter(Boolean).join('\n');
    const historyText = history
      .map((m) => `${m?.role || 'unknown'}: ${typeof m?.text === 'string' ? m.text : ''}`)
      .join('\n');
    const lastAssistantMessage = getLastAssistantMessage(history);

    if (isImmediateSubmit(lower)) {
      const submissionMessage = getSubmissionMessage(message, history);
      const complaint = withHistoricalUserContext(
        extractComplaint(submissionMessage, userConversationLower),
        history
      );
      const feedback = buildFeedbackSummary({
        clientId,
        complaint,
        historyText,
        latestMessage: submissionMessage,
        userRequestedImmediatePass: true,
      });

      return res.status(200).json({
        reply: 'Understood, Mr P. I’ll pass that to Fiker now.',
        done: true,
        feedback,
      });
    }

    if (
      didLastAssistantAskForSendConfirmation(lastAssistantMessage) &&
      isApprovalReply(lower)
    ) {
      const submissionMessage = getSubmissionMessage(message, history);
      const complaint = withHistoricalUserContext(
        extractComplaint(submissionMessage, userConversationLower),
        history
      );
      const feedback = buildFeedbackSummary({
        clientId,
        complaint,
        historyText,
        latestMessage: submissionMessage,
        userRequestedImmediatePass: true,
      });

      return res.status(200).json({
        reply: 'Understood, Mr P. I’ll pass that to Fiker now.',
        done: true,
        feedback,
      });
    }

    if (isGreetingOnly(lower)) {
      return res.status(200).json({
        reply: `${getTimeGreeting()}, Mr P. Do you have any feedback for me today?`,
        done: false,
      });
    }

    if (isSmallTalk(lower)) {
      return res.status(200).json({
        reply: buildSmallTalkReply(lower),
        done: false,
      });
    }

    const complaint = extractComplaint(message, userConversationLower);
    const clarificationCount = countAssistantClarifications(history);

    if (hasEnoughToSummarize(complaint)) {
      if (clarificationCount >= 2) {
        const feedbackPreview = buildFeedbackSummary({
          clientId,
          complaint,
          historyText,
          latestMessage: message,
          userRequestedImmediatePass: false,
        });

        return res.status(200).json({
          reply: 'Understood, Mr P. I have enough to pass this to Fiker. Would you like me to send it now?',
          done: false,
          feedback_preview: feedbackPreview.summary,
        });
      }

      const followUp = makeFollowUpQuestion(complaint, clarificationCount);
      if (followUp) {
        return res.status(200).json({
          reply: followUp,
          done: false,
        });
      }

      const feedbackPreview = buildFeedbackSummary({
        clientId,
        complaint,
        historyText,
        latestMessage: message,
        userRequestedImmediatePass: false,
      });

      return res.status(200).json({
        reply: 'Understood, Mr P. I have enough to pass this to Fiker. Would you like me to send it now?',
        done: false,
        feedback_preview: feedbackPreview.summary,
      });
    }

    return res.status(200).json({
      reply: makeFallbackClarification(complaint, lower, lastAssistantMessage),
      done: false,
    });
  } catch (err) {
    console.error('chat.js error:', err);
    return res.status(500).json({
      error: 'Server error',
      reply: 'Something went wrong on my side. Please try again in a moment.',
    });
  }
};

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function unique(items) {
  return [...new Set(items)];
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getUserHistoryText(history) {
  return history
    .filter((item) => item && item.role === 'user' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

function getLastAssistantMessage(history) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item && item.role === 'assistant' && typeof item.text === 'string' && item.text.trim()) {
      return item.text.trim();
    }
  }

  return '';
}

function getSubmissionMessage(currentMessage, history) {
  const currentLower = normalize(currentMessage);

  if (!isApprovalReply(currentLower)) {
    return currentMessage;
  }

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (!item || item.role !== 'user' || typeof item.text !== 'string') continue;

    const text = item.text.trim();
    if (!text) continue;

    const lower = normalize(text);
    if (isApprovalReply(lower)) continue;

    return text;
  }

  return currentMessage;
}

function isGreetingOnly(lower) {
  const greetingPhrases = [
    'hi',
    'hello',
    'hey',
    'hi love',
    'hello love',
    'hey love',
    'hi dear',
    'hello dear',
    'hey dear',
    'hi lana',
    'hello lana',
    'hey lana',
    'good morning',
    'good morning love',
    'good morning dear',
    'good morning lana',
    'good afternoon',
    'good afternoon love',
    'good afternoon dear',
    'good afternoon lana',
    'good evening',
    'good evening love',
    'good evening dear',
    'good evening lana',
  ];

  return greetingPhrases.includes(lower);
}

function isSmallTalk(lower) {
  const smallTalkPhrases = [
    'how are you',
    'how are you doing',
    'how are u',
    'how r you',
    'how have you been',
    'how do you do',
    'what s up',
    'whats up',
    'what is up',
    'how is your day',
    'how s your day',
    'are you okay',
    'you good',
    'i asked you how are you',
    'i asked how are you',
  ];

  return smallTalkPhrases.includes(lower);
}

function buildSmallTalkReply(lower) {
  if (
    lower.includes('i asked you how are you') ||
    lower.includes('i asked how are you')
  ) {
    return `${getTimeGreeting()}, Mr P. I’m well, thank you. What would you like me to help with today?`;
  }

  if (
    lower.includes('how are you') ||
    lower.includes('how are u') ||
    lower.includes('how r you') ||
    lower.includes('how are you doing') ||
    lower.includes('how have you been')
  ) {
    return `${getTimeGreeting()}, Mr P. I’m well, thank you. Do you have any feedback for me today?`;
  }

  if (
    lower.includes('what s up') ||
    lower.includes('whats up') ||
    lower.includes('what is up') ||
    lower.includes('you good') ||
    lower.includes('are you okay')
  ) {
    return 'I’m well, thank you, Mr P. Is there anything you’d like me to pass on today?';
  }

  if (
    lower.includes('how is your day') ||
    lower.includes('how s your day')
  ) {
    return 'It’s going well, thank you, Mr P. Do you have any feedback or issue you’d like me to help with today?';
  }

  return `${getTimeGreeting()}, Mr P. What would you like me to help with today?`;
}

function isApprovalReply(lower) {
  const approvals = [
    'yes',
    'yeah',
    'yep',
    'ok',
    'okay',
    'sure',
    'go ahead',
    'do it',
    'send it',
    'pass it',
    'submit it',
  ];

  return approvals.includes(lower);
}

function userIsAddingMoreDetail(lower) {
  return (
    includesAny(lower, [
      'one more detail',
      'another detail',
      'one more thing',
      'another thing',
      'before you send it',
      'before you send',
      'when you send it',
      'when you send',
      'include this too',
      'include that too',
      'add this too',
      'add that too',
      'wait before you send',
      'dont send yet',
      "don't send yet",
      'not yet',
      'hold on',
    ]) ||
    (/^and\b/.test(lower) && includesAny(lower, ['detail', 'also', 'too']))
  );
}

function didLastAssistantAskForSendConfirmation(text) {
  const lower = normalize(text);

  return (
    lower.includes('would you like me to send it now') ||
    lower.includes('would you like me to pass that to fiker now') ||
    lower.includes('would you like me to pass this to fiker now') ||
    lower.includes('would you like me to pass it to fiker now')
  );
}

function isImmediateSubmit(lower) {
  if (userIsAddingMoreDetail(lower)) {
    return false;
  }

  const triggers = [
    'just tell fiker',
    'tell fiker',
    'pass it to fiker',
    'pass this to fiker',
    'just pass it to fiker',
    'just pass my complaint to fiker',
    'just tell what i said to fiker',
    'just tell what i said to fiker thats all',
    "just tell what i said to fiker that's all",
    'pass it on',
    'just pass it on',
    'pass it',
    'send it',
    'send this',
    'log it',
    'submit it',
    'thats all',
    "that's all",
    'that is all',
    'no more',
    'thats enough',
    "that's enough",
    'just pass it',
    'just send it',
    'just tell him',
    'just tell her',
    'dont ask more questions',
    "don't ask more questions",
    'no more questions',
    'just pass this on',
    'send it as is',
    'pass this as is',
  ];

  return triggers.some((phrase) => lower.includes(normalize(phrase)));
}

function countAssistantClarifications(history) {
  let count = 0;

  for (const item of history) {
    if (!item || item.role !== 'assistant' || typeof item.text !== 'string') continue;

    const text = normalize(item.text);

    if (
      text.includes('what seems to be the main issue') ||
      text.includes('would you like me to pass that to fiker now') ||
      text.includes('would you like me to send it now') ||
      text.includes('or is there one more detail you want to add') ||
      text.includes('did the app') ||
      text.includes('was the main problem') ||
      text.includes('was the wrong document') ||
      text.includes('what happened') ||
      text.includes('what did you expect instead') ||
      text.includes('did this happen once') ||
      text.includes('is this mainly about') ||
      text.includes('do you mean') ||
      text.includes('did the slowness affect') ||
      text.includes('did this mainly affect your confidence') ||
      text.includes('what part of the app are you referring to')
    ) {
      count += 1;
    }
  }

  return count;
}

function hasEnoughToSummarize(complaint) {
  return Boolean(
    complaint.agent ||
    complaint.categories.length ||
    complaint.issues.length ||
    complaint.taskAttempted ||
    complaint.whatHappened ||
    complaint.expectedBehavior
  );
}

function currentMessageClearlyTargetsLana(currentLower) {
  if (!currentLower.includes('lana')) return false;
  if (isGreetingOnly(currentLower) || isSmallTalk(currentLower)) return false;

  const lanaProblemPatterns = [
    /\blana\b.*\b(slow|delay|lag|confusing|unclear|wrong|broken|stuck|fake|bad|problem|issue|complaint|feedback|not working|too long)\b/,
    /\b(problem|issue|complaint|feedback)\b.*\blana\b/,
    /\bwith lana\b.*\b(problem|issue|slow|confusing|unclear|wrong|broken|stuck|bad)\b/,
    /\blana\b.*\b(is|was|feels|seems|keeps|takes|gave|gives|did|does|has)\b/,
  ];

  return lanaProblemPatterns.some((pattern) => pattern.test(currentLower));
}

function detectHistoricalUserAgent(history) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (!item || item.role !== 'user' || typeof item.text !== 'string') continue;

    const lower = normalize(item.text);

    if (currentMessageClearlyTargetsLana(lower)) return 'Lana';
    if (includesAny(lower, ['chanelle'])) return 'Chanelle';
    if (includesAny(lower, ['sofie'])) return 'Sofie';
    if (includesAny(lower, ['mimi'])) return 'Mimi';
    if (includesAny(lower, ['agents', 'agent'])) return 'agents';
  }

  return '';
}

function withHistoricalUserContext(complaint, history) {
  if (complaint.agent) return complaint;

  const historicalAgent = detectHistoricalUserAgent(history);

  return {
    ...complaint,
    agent: historicalAgent || complaint.agent,
    taskAttempted:
      complaint.taskAttempted ||
      (historicalAgent ? `Use ${historicalAgent} in the legal assistant app` : ''),
  };
}

function extractComplaint(message, userConversationLower) {
  const currentLower = normalize(message);
  let agent = '';

  if (includesAny(userConversationLower, ['chanelle'])) agent = 'Chanelle';
  else if (includesAny(userConversationLower, ['sofie'])) agent = 'Sofie';
  else if (includesAny(userConversationLower, ['mimi'])) agent = 'Mimi';
  else if (currentMessageClearlyTargetsLana(currentLower)) agent = 'Lana';
  else if (includesAny(userConversationLower, ['agents', 'agent'])) agent = 'agents';

  const categories = [];
  const issues = [];
  const summaryBits = [];

  if (
    includesAny(userConversationLower, [
      'answer',
      'response',
      'messy',
      'too long',
      'unclear',
      'confusing',
      'doesnt make sense',
      "doesn't make sense",
    ])
  ) {
    categories.push('quality of answer');
  }

  if (includesAny(userConversationLower, ['chanelle', 'sofie', 'mimi', 'agent behavior', 'fake', 'acted weird'])) {
    categories.push('agent behavior');
  }

  if (includesAny(userConversationLower, ['collaboration', 'handoff', 'sofie helped', 'mimi', 'in progress', 'stuck'])) {
    categories.push('collaboration flow');
  }

  if (includesAny(userConversationLower, ['document', 'file', 'uploaded', 'upload', 'case file', 'wrong document'])) {
    categories.push('document handling');
  }

  if (includesAny(userConversationLower, ['email', 'calendar', 'outlook', 'microsoft'])) {
    categories.push('email/calendar behavior');
  }

  if (includesAny(userConversationLower, ['voice', 'microphone', 'audio', 'speak'])) {
    categories.push('voice interaction');
  }

  if (includesAny(userConversationLower, ['ui', 'ux', 'screen', 'button', 'layout', 'window', 'page'])) {
    categories.push('ui/ux');
  }

  if (includesAny(userConversationLower, ['slow', 'speed', 'takes too long', 'delay', 'lag', 'waiting', 'performance', 'respond'])) {
    categories.push('speed/performance');
  }

  if (includesAny(userConversationLower, ['trust', 'privacy', 'private', 'confidential', 'unsafe', 'wrong file'])) {
    categories.push('trust/privacy');
  }

  if (includesAny(userConversationLower, ['slow', 'takes too long', 'long to respond', 'delay', 'lag', 'waiting'])) {
    issues.push('slow response time');
    summaryBits.push('response time feels too slow');
  }

  if (includesAny(userConversationLower, ['doesnt make sense', "doesn't make sense", 'confusing', 'unclear', 'messy'])) {
    issues.push('unclear or low-quality responses');
    summaryBits.push('some responses do not make sense or feel unclear');
  }

  if (includesAny(userConversationLower, ['stuck', 'in progress', 'loading', 'fake'])) {
    issues.push('workflow feels unreliable or misleading');
    summaryBits.push('the workflow may feel misleading, stuck, or not trustworthy');
  }

  if (includesAny(userConversationLower, ['wrong document', 'used the wrong document', 'mixed with unrelated', 'older unrelated file'])) {
    issues.push('document mix-up risk');
    summaryBits.push('the app may be pulling the wrong or unrelated document');
  }

  if (includesAny(userConversationLower, ['not working', 'broken', 'fails', 'error', 'issue', 'problem'])) {
    issues.push('general functionality problem');
    summaryBits.push('there appears to be a functionality issue');
  }

  if (includesAny(userConversationLower, ['missing', 'wish', 'should do', 'feature', 'could do'])) {
    issues.push('missing capability or improvement request');
    summaryBits.push('there may be something missing or needing improvement');
  }

  let taskAttempted = '';
  let whatHappened = '';
  let expectedBehavior = '';
  const preciseReport = extractPreciseReport(message);

  if (agent) {
    taskAttempted = `Use ${agent} in the legal assistant app`;
  }

  if (preciseReport) {
    whatHappened = preciseReport;
  } else if (issues.length) {
    whatHappened = issues.join('; ');
  }

  if (includesAny(userConversationLower, ['too long to respond', 'takes too long', 'slow'])) {
    expectedBehavior = expectedBehavior
      ? `${expectedBehavior}; faster replies`
      : 'faster replies';
  }

  if (includesAny(userConversationLower, ['doesnt make sense', "doesn't make sense", 'confusing', 'unclear', 'messy'])) {
    expectedBehavior = expectedBehavior
      ? `${expectedBehavior}; clearer answers`
      : 'clearer answers';
  }

  const severity = inferSeverity(userConversationLower, issues, categories);

  if (message.trim()) {
    summaryBits.push(`latest user wording: "${message.trim()}"`);
  }

  return {
    agent,
    categories: unique(categories),
    issues: unique(issues),
    summaryBits: unique(summaryBits),
    taskAttempted,
    whatHappened,
    expectedBehavior,
    severity,
    preciseReport,
  };
}

function extractPreciseReport(message) {
  const text = String(message || '').trim();
  if (!text) return '';

  const lower = normalize(text);

  if (
    includesAny(lower, [
      'failed before startup',
      'fails before startup',
      'crashes on',
      'crashed on',
      'configerror',
      'error',
      'exception',
      'traceback',
      'pydantic',
      'chromadb',
      'should not have sent',
      'sent it immediately',
      'wait because i wanted',
      'before you send it',
    ]) ||
    text.length >= 120
  ) {
    return text;
  }

  return '';
}

function inferSeverity(userConversationLower, issues, categories) {
  if (
    includesAny(userConversationLower, ['privacy', 'private', 'confidential', 'wrong document', 'misleading', 'trust dropped']) ||
    (categories.includes('trust/privacy') && issues.length)
  ) {
    return 'High';
  }

  if (
    includesAny(userConversationLower, ['broken', 'failed', 'not working', 'error']) &&
    !includesAny(userConversationLower, ['minor', 'small'])
  ) {
    return 'High';
  }

  if (
    includesAny(userConversationLower, ['slow', 'confusing', 'unclear', 'messy', 'fake', 'stuck']) ||
    issues.length >= 2
  ) {
    return 'Medium';
  }

  return 'Low';
}

function makeFollowUpQuestion(complaint, clarificationCount) {
  if (clarificationCount >= 1) return '';

  if (complaint.categories.includes('document handling')) {
    return 'Understood, Mr P. Was the issue that the wrong document was pulled in, or that a temporary upload was treated like a case file?';
  }

  if (complaint.categories.includes('collaboration flow')) {
    return 'Understood, Mr P. Did the collaboration feel unclear because the handoff looked fake, or because the app seemed stuck or misleading?';
  }

  if (complaint.categories.includes('quality of answer') && complaint.categories.includes('speed/performance')) {
    return 'Understood, Mr P. I have that the replies feel slow and some answers do not make sense. Would you like me to pass that to Fiker now, or is there one more detail you want to add?';
  }

  if (complaint.categories.includes('quality of answer')) {
    return 'Understood, Mr P. Was the main problem the clarity of the answer, the structure, or that it missed the point?';
  }

  if (complaint.categories.includes('speed/performance')) {
    return 'Understood, Mr P. Did the slowness affect the first reply, the back-and-forth, or both?';
  }

  if (complaint.categories.includes('trust/privacy')) {
    return 'Understood, Mr P. Did this mainly affect your confidence in the app, your sense of privacy, or both?';
  }

  if (complaint.agent) {
    return `Understood, Mr P. What seems to be the main issue with ${complaint.agent}?`;
  }

  return '';
}

function makeFallbackClarification(complaint, lower, lastAssistantMessage) {
  const lastAssistantLower = normalize(lastAssistantMessage);

  if (
    didLastAssistantAskForSendConfirmation(lastAssistantMessage) &&
    userIsAddingMoreDetail(lower)
  ) {
    return 'Understood, Mr P. I’ll wait. Please add the extra detail you want included before I send it to Fiker.';
  }

  if (['both', 'first reply', 'back and forth', 'back and forth only', 'yes', 'no'].includes(lower)) {
    if (lastAssistantLower.includes('did the slowness affect the first reply the back and forth or both')) {
      return 'Understood, Mr P. I now have that the slowness affected both the first reply and the back-and-forth. Would you like me to pass that to Fiker now?';
    }

    if (lastAssistantLower.includes('was the main problem the clarity of the answer the structure or that it missed the point')) {
      return 'Understood, Mr P. I’ve noted that. Would you like me to pass that to Fiker now?';
    }
  }

  if (complaint.agent) {
    return `I understand, Mr P. What seems to be the main issue with ${complaint.agent}?`;
  }

  return 'I understand, Mr P. What part of the app are you referring to, and what felt wrong or incomplete?';
}

function buildFeedbackSummary({
  clientId,
  complaint,
  historyText,
  latestMessage,
  userRequestedImmediatePass,
}) {
  const subject = complaint.agent
    ? `Feedback from Mr P about ${complaint.agent}`
    : 'Feedback from Mr P';

  const impact = inferImpact(complaint);
  const categoryText = complaint.categories.length
    ? complaint.categories.join('; ')
    : 'general product feedback';

  const summaryLines = [
    'Feedback summary:',
    `- Task attempted: ${complaint.taskAttempted || 'Not fully specified'}`,
    `- What happened: ${complaint.whatHappened || latestMessage || 'Not fully specified'}`,
    `- Expected behavior: ${complaint.expectedBehavior || 'Needs clearer, smoother, or more reliable behavior'}`,
    `- Impact: ${impact}`,
    `- Severity: ${complaint.severity}`,
    `- Suggested category: ${categoryText}`,
  ];

  if (userRequestedImmediatePass) {
    summaryLines.push('- User instruction: Mr P asked for the feedback to be passed on without further follow-up.');
  }

  return {
    type: 'feedback_note',
    client_id: clientId,
    subject,
    summary: summaryLines.join('\n'),
    complaint: {
      agent: complaint.agent || null,
      categories: complaint.categories,
      issues: complaint.issues,
      task_attempted: complaint.taskAttempted || null,
      what_happened: complaint.whatHappened || latestMessage,
      expected_behavior: complaint.expectedBehavior || null,
      severity: complaint.severity,
      latest_message: latestMessage,
      user_requested_immediate_pass: userRequestedImmediatePass,
    },
    conversation_excerpt: historyText,
    created_at: new Date().toISOString(),
  };
}

function inferImpact(complaint) {
  if (complaint.categories.includes('trust/privacy')) {
    return 'Trust or confidence may have dropped.';
  }

  if (complaint.categories.includes('speed/performance') && complaint.categories.includes('quality of answer')) {
    return 'The experience felt slower and less useful than expected.';
  }

  if (complaint.categories.includes('collaboration flow')) {
    return 'The workflow may have felt unclear or less believable.';
  }

  if (complaint.categories.includes('document handling')) {
    return 'This may affect confidence in file accuracy and matter separation.';
  }

  if (complaint.categories.includes('quality of answer')) {
    return 'The answer quality reduced clarity and usefulness.';
  }

  return 'The experience felt degraded or less smooth than expected.';
}
