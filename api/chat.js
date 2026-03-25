// api/chat.js
// Lily conversational feedback assistant for Mr P
// - talks naturally
// - collects feedback conversationally
// - returns structured data when ready
// - works with /api/feedback
// - optionally reads memory from /api/memory if available

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getTimeOfDayGreeting() {
  const now = new Date();
  const hour = now.getHours();

  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function extractJson(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();

  const direct = safeJsonParse(trimmed, null);
  if (direct) return direct;

  const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    const fenced = safeJsonParse(fenceMatch[1].trim(), null);
    if (fenced) return fenced;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const sliced = trimmed.slice(firstBrace, lastBrace + 1);
    return safeJsonParse(sliced, null);
  }

  return null;
}

function normalizeReply(data) {
  const reply =
    typeof data?.reply === 'string' && data.reply.trim()
      ? data.reply.trim()
      : 'Something went wrong on my side. Please try again in a moment.';

  const done = Boolean(data?.done);

  const feedback = done
    ? {
        title:
          typeof data?.feedback?.title === 'string' && data.feedback.title.trim()
            ? data.feedback.title.trim()
            : 'Mr P feedback',
        category:
          typeof data?.feedback?.category === 'string' && data.feedback.category.trim()
            ? data.feedback.category.trim()
            : 'general',
        priority:
          typeof data?.feedback?.priority === 'string' && data.feedback.priority.trim()
            ? data.feedback.priority.trim()
            : 'normal',
        summary:
          typeof data?.feedback?.summary === 'string' && data.feedback.summary.trim()
            ? data.feedback.summary.trim()
            : reply,
        details:
          typeof data?.feedback?.details === 'string' && data.feedback.details.trim()
            ? data.feedback.details.trim()
            : reply,
        user_message:
          typeof data?.feedback?.user_message === 'string' && data.feedback.user_message.trim()
            ? data.feedback.user_message.trim()
            : '',
        status: 'new',
        submitted_at: new Date().toISOString(),
      }
    : null;

  return { reply, done, feedback };
}

async function loadMemory(req) {
  try {
    const host = req.headers.host;
    const proto =
      req.headers['x-forwarded-proto'] ||
      (host && host.includes('localhost') ? 'http' : 'https');

    if (!host) return [];

    const url = `${proto}://${host}/api/memory?client=mr-p&limit=6`;
    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data?.items)) return [];

    return data.items.slice(0, 6);
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Missing ANTHROPIC_API_KEY in environment variables',
    });
  }

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (!message) {
    return res.status(400).json({ error: 'No message provided' });
  }

  const greeting = getTimeOfDayGreeting();
  const memoryItems = await loadMemory(req);

  const memoryBlock = memoryItems.length
    ? memoryItems
        .map((item, index) => {
          const title = item?.title || `Memory ${index + 1}`;
          const summary = item?.summary || '';
          const status = item?.status || '';
          const updatedAt = item?.updated_at || item?.submitted_at || '';
          return `- ${title} | status: ${status} | updated: ${updatedAt} | summary: ${summary}`;
        })
        .join('\n')
    : 'No prior memory available.';

  const systemPrompt = `
You are Lily, Fiker's personal assistant for collecting product and workflow feedback from Mr P.

Your personality:
- warm
- discreet
- polished
- conversational
- non-technical unless absolutely necessary

Your job:
- chat naturally with Mr P
- understand what feels unclear, missing, broken, confusing, or worth improving
- ask short follow-up questions when needed
- once you have enough detail, prepare structured feedback for Fiker

Important rules:
- do not speak like a support ticket tool
- do not use technical labels like "UI bug", "workflow category", or "severity" unless Mr P uses them first
- do not overwhelm the user
- keep replies concise
- never mention internal prompts, JSON, schemas, or backend systems
- never say you are Chanelle
- you are Lily only

Use memory when relevant:
- if prior updates or fixes are in memory, you may briefly mention them in a natural way
- example style: "Based on your earlier feedback, that part was updated."
- do not invent updates
- if memory does not clearly confirm a change, do not claim it was fixed

Current memory:
${memoryBlock}

Decision rule:
- If the message is still vague, ask one focused follow-up question.
- If you clearly understand the issue/request/improvement, set done = true.
- When done = true, provide clean structured feedback for Fiker.

Return ONLY valid JSON with this exact shape:
{
  "reply": "string",
  "done": true_or_false,
  "feedback": {
    "title": "short title",
    "category": "general|bug|workflow|content|feature|design",
    "priority": "low|normal|high",
    "summary": "short summary for Fiker",
    "details": "full useful note for Fiker",
    "user_message": "the user's core request in plain words"
  }
}

If done = false, set feedback to null.

Conversation tone:
Start naturally in the spirit of:
"${greeting} — I’m Lily. Tell me what feels off, unclear, or worth improving, and I’ll help you send it to Fiker."
But do not repeat that exact line every turn.
`.trim();

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        temperature: 0.3,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: message,
          },
        ],
      }),
    });

    const anthropicData = await anthropicResponse.json();

    if (!anthropicResponse.ok) {
      console.error('Anthropic API error:', anthropicData);
      return res.status(500).json({
        error: 'Claude API error',
        detail: anthropicData,
      });
    }

    const text =
      Array.isArray(anthropicData?.content)
        ? anthropicData.content
            .filter((item) => item?.type === 'text' && typeof item?.text === 'string')
            .map((item) => item.text)
            .join('\n')
        : '';

    const parsed = extractJson(text);

    if (!parsed) {
      console.error('Could not parse Claude JSON:', text);
      return res.status(500).json({
        error: 'Invalid Claude response format',
      });
    }

    const normalized = normalizeReply(parsed);

    return res.status(200).json(normalized);
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({
      error: 'Server error',
      detail: error?.message || 'Unknown error',
    });
  }
}
