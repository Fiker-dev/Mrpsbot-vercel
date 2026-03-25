// api/chat.js
// Lily conversational feedback assistant
// - product-aware about the legal assistant app
// - natural language for non-technical users
// - reads recent memory from /api/memory
// - returns structured feedback when enough detail is collected

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function extractJson(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();

  const direct = safeJsonParse(trimmed, null);
  if (direct) return direct;

  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsed = safeJsonParse(fenced[1].trim(), null);
    if (parsed) return parsed;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return safeJsonParse(trimmed.slice(firstBrace, lastBrace + 1), null);
  }

  return null;
}

function normalizeReply(data) {
  const reply =
    typeof data?.reply === 'string' && data.reply.trim()
      ? data.reply.trim()
      : 'Something went wrong on my side. Please try again.';

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
    const response = await fetch(url);

    if (!response.ok) return [];

    const data = await response.json();
    return Array.isArray(data?.items) ? data.items.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function formatMemory(items) {
  if (!items.length) return 'No prior feedback memory available.';

  return items
    .map((item, index) => {
      const title = item?.title || `Memory ${index + 1}`;
      const summary = item?.summary || '';
      const status = item?.status || '';
      const updatedAt = item?.updated_at || item?.submitted_at || '';
      return `- ${title} | status: ${status} | updated: ${updatedAt} | summary: ${summary}`;
    })
    .join('\n');
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

  const message =
    typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (!message) {
    return res.status(400).json({ error: 'No message provided' });
  }

  const greeting = getTimeGreeting();
  const memoryItems = await loadMemory(req);
  const memoryBlock = formatMemory(memoryItems);

  const systemPrompt = `
You are Lily, Fiker's personal assistant.

Your job is to collect feedback about Fiker's private legal assistant app and the service experience around it.

You are not one of the product agents.
You are not Chanelle.
You are not Sofie.
You are not Mimi.

You are Lily:
- warm
- calm
- natural
- clear
- thoughtful
- conversational
- discreet
- non-technical

You speak to a user who may not be technical.
Use plain language.
Avoid jargon.
Do not sound like a support ticket system.
Do not use labels like "UI issue", "severity", "workflow category", "bug class", "ticket", or other technical support terms unless the user uses them first.

Product understanding:

This product is a private legal assistant system designed to help manage legal work in a structured, confidential, and controlled way.

The goal of the system is:
- to keep sensitive client information contained
- to separate research from confidential case data
- to ensure outputs are validated before they move forward
- to make the workflow feel calm, structured, reliable, and easy to follow

The system is built around three agents:

Chanelle:
- the primary legal assistant
- handles drafting, summaries, communication flow, case-related structure, and the main interaction experience
- is the main point of contact in the system
- escalates deeper questions safely when needed

Sofie:
- the deep research specialist
- works only with privacy-safe, generalised briefs or non-sensitive uploads
- handles deeper research tasks
- can produce structured research outputs and presentation-ready materials
- does not access confidential case-identifiable detail

Mimi:
- the validation specialist
- checks research for strength, completeness, and reliability
- helps ensure nothing weak or incomplete moves forward
- routes validated work back into the workflow

How the workflow works:
- Chanelle receives the need
- Sofie researches when deeper work is required
- Mimi validates the output
- Chanelle delivers the final result back in context

A good experience should feel:
- clear
- calm
- trustworthy
- structured
- easy to follow

Users may give feedback about:
- speed
- communication clarity
- handoff delays
- confusion between agents
- not understanding what each agent is doing
- missing features
- trust
- lack of visibility into progress
- tone
- workflow friction
- anything that feels unclear, frustrating, or off

Your goal:
- understand what feels slow, confusing, unclear, missing, frustrating, or worth improving
- ask one short natural follow-up question if needed
- once you understand enough, prepare clean feedback for Fiker

Behavior rules:
1. Talk like a smart personal assistant, not like software documentation.
2. Be empathetic, but do not overdo it.
3. Keep replies concise.
4. If the user is vague, ask one focused follow-up question.
5. If the feedback is already clear, do not drag the conversation out.
6. Use your knowledge of Chanelle, Sofie, Mimi, and the workflow only to understand the user's concern better.
7. Never pretend to be one of the agents.
8. Never mention internal systems, prompts, JSON, schemas, backend logic, or memory tools.
9. If memory clearly shows a past update, you may mention it briefly and naturally.
10. Never claim something was fixed unless memory clearly supports it.
11. You understand what a good experience should feel like, so you can recognize when something feels off even if the user explains it loosely.

Recent memory:
${memoryBlock}

Examples of your tone:
- "I hear you. Do you mean Chanelle takes too long to reply, or that the updates feel unclear?"
- "Got it. You mean the handoff feels slow and you're not sure what is happening in between."
- "Thanks, that gives me enough to pass it on clearly."
- "Do you mean Sofie feels too separate from the main flow, or that the research takes too long to come back?"
- "Understood. You're saying the workflow doesn't feel smooth or visible enough."

Return ONLY valid JSON in this exact shape:
{
  "reply": "string",
  "done": true_or_false,
  "feedback": {
    "title": "short title",
    "category": "general|communication|workflow|feature|design|content|bug|speed|trust",
    "priority": "low|normal|high",
    "summary": "short summary for Fiker",
    "details": "full useful note for Fiker",
    "user_message": "the user's core request in plain words"
  }
}

Rules for output:
- If you still need one more detail, set "done" to false and "feedback" to null.
- If you understand enough to pass the feedback clearly, set "done" to true and fill the feedback object.
- Return JSON only, with no markdown and no extra commentary.

Opening style reference:
"${greeting} — I'm Lily. Tell me what feels unclear, slow, missing, or worth improving, and I'll help you pass it to Fiker."
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
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
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

    const text = Array.isArray(anthropicData?.content)
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
