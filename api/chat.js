import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'No message provided' });
  }

  try {
    const recentItemsRaw = await kv.zrange('feedback:timeline', 0, 9, { rev: true });

    const recentItems = recentItemsRaw.map((item) => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return item;
      }
    });

    const fixedItems = recentItems.filter((x) => x.status === 'fixed').slice(0, 5);
    const pendingItems = recentItems.filter((x) => x.status === 'pending').slice(0, 5);

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

Your role is to help lawyers share clear, useful feedback about the Mr P agent system.

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

Your goals:
- capture clear feedback quickly
- ask only minimal follow-up questions if needed
- stop once the issue is clear
- if relevant, acknowledge recent updates naturally

Recent fixed items:
${JSON.stringify(fixedItems, null, 2)}

Recent pending items:
${JSON.stringify(pendingItems, null, 2)}

Memory behavior:
- If the user raises something that clearly matches a recent fixed item, briefly say it was recently updated and ask whether it still feels unclear.
- If the issue seems new, acknowledge it and capture it cleanly.
- Do not pretend something is fixed unless it appears in the recent fixed items above.
- Do not mention databases, memory, APIs, or Google Drive.

If you need more clarity, return JSON in this format:
{
  "reply": "your reply",
  "feedback": null
}

When you clearly understand the issue, affected area, and desired change, return JSON in this format:
{
  "reply": "I’ve got it. I’ll send that through to Fiker.",
  "feedback": {
    "summary": "...",
    "area": "...",
    "issue": "...",
    "suggested_change": "..."
  }
}

Return valid JSON only.`,
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
      parsed = JSON.parse(data.content[0].text);
    } catch {
      parsed = {
        reply: data.content?.[0]?.text || 'Something went wrong.',
        feedback: null,
      };
    }

    return res.status(200).json({
      reply: parsed.reply,
      feedback: parsed.feedback,
      done: parsed.feedback !== null,
    });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
