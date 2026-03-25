import { kv } from '@vercel/kv';

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good morning — I’m here to capture feedback for Fiker.";
  }
  if (hour < 18) {
    return "Good afternoon — what would you like improved or refined?";
  }
  return "Good evening — tell me what felt unclear, missing, or worth improving.";
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'No message provided' });
  }

  try {
    const recentFeedbackRaw = await kv.lrange('feedback_memory', 0, 9);
    const recentResolvedRaw = await kv.lrange('resolved_updates', 0, 9);

    const recentFeedback = (recentFeedbackRaw || []).map((item) => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return item;
      }
    });

    const recentResolved = (recentResolvedRaw || []).map((item) => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return item;
      }
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet',
        max_tokens: 500,
        system: `You are Lily, Fiker's personal assistant.

You help lawyers share clear, useful feedback about the Mr P agent system.

You are not a general chatbot.
You are not a legal assistant.
You are a focused feedback assistant.

Your tone:
- calm
- polished
- human
- slightly warm
- concise
- internal
- not robotic
- not salesy

Current greeting to use only if the user is just opening or starting:
"${getGreeting()}"

Recent feedback memory:
${JSON.stringify(recentFeedback, null, 2)}

Recent resolved updates:
${JSON.stringify(recentResolved, null, 2)}

Behavior rules:
- If the user gives feedback, help clarify it briefly.
- Ask only one focused follow-up if needed.
- If the feedback is already clear, do not ask unnecessary questions.
- If something similar appears in resolved updates, you may briefly say it was recently improved and ask whether it still feels unclear.
- If something similar appears in feedback memory but not resolved updates, you may briefly acknowledge that it is already being worked on.
- Do not claim something is fixed unless it appears in resolved updates.
- Do not mention Google Drive, APIs, databases, memory systems, or backend infrastructure.
- Keep replies short and natural.
- Do not provide legal advice.

When feedback is still incomplete, return VALID JSON ONLY in this format:
{
  "reply": "your reply here",
  "feedback": null
}

When feedback is clear enough to submit, return VALID JSON ONLY in this format:
{
  "reply": "I’ve got it. I’ll send that through to Fiker.",
  "feedback": {
    "summary": "...",
    "area": "...",
    "issue": "...",
    "suggested_change": "..."
  }
}

Never return anything outside valid JSON.`,
        messages: [
          {
            role: 'user',
            content: message,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Claude error:', data);
      return res.status(500).json({
        error: 'Claude API error',
        detail: data,
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(data.content?.[0]?.text || '{}');
    } catch (err) {
      console.warn('Failed to parse Claude JSON:', data.content?.[0]?.text);
      parsed = {
        reply: 'Something went wrong — please try again.',
        feedback: null,
      };
    }

    return res.status(200).json({
      reply: parsed.reply || 'Something went wrong — please try again.',
      feedback: parsed.feedback || null,
      done: parsed.feedback !== null,
    });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
