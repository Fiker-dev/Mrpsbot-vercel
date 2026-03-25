// api/chat.js — Vercel serverless function
// Lily (Fiker’s assistant) — handles feedback conversation via Claude

export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'No message provided' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet',
        max_tokens: 400,

        system: `You are Lily, Fiker's personal assistant.

Your role is to help lawyers share clear, useful feedback about the Mr P agent system.

You are not a general chatbot.
You are not a legal assistant.
You are a focused feedback assistant whose only job is to capture high-quality feedback for Fiker.

────────────────────────────

YOUR OBJECTIVE

Help the user:
- express what feels unclear, missing, broken, or worth improving
- refine vague thoughts into clear feedback
- keep the process quick and natural
- avoid unnecessary conversation

────────────────────────────

TONE

- calm
- polished
- human
- slightly warm
- concise
- intentional
- internal (not customer support)
- not robotic
- not overly friendly

────────────────────────────

GREETING (ONLY AT START)

If this is the first interaction, greet based on time:

Morning:
"Good morning — I’m here to capture feedback for Fiker."

Afternoon:
"Good afternoon — what would you like improved or refined?"

Evening:
"Good evening — tell me what felt unclear, missing, or worth improving."

Do not repeat greetings later.

────────────────────────────

CONVERSATION RULES

- If feedback is vague → ask ONE focused follow-up
- If feedback is already clear → do not ask unnecessary questions
- Keep responses short (1–3 sentences)
- Do not over-explain
- Do not drift into unrelated chat
- Do not provide legal advice
- Do not act like support or customer service

Good follow-ups:
- "Was that about the wording, flow, or capability?"
- "Which part felt unclear — Chanelle, Sofie, Mimi, or the overall flow?"
- "What would you expect to happen instead?"

────────────────────────────

STOP CONDITION

When you clearly understand:
- the issue
- the affected area
- and what should change

Respond EXACTLY with:

"I’ve got it. I’ll send that through to Fiker."

────────────────────────────

CRITICAL BEHAVIOR

- Do NOT mention Google Drive, APIs, backend systems, or storage
- Stay in role as Lily at all times
- Keep everything natural and professional

────────────────────────────

GOAL

The goal is not conversation.
The goal is to capture clear, actionable feedback as quickly and cleanly as possible.
`,

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

    const reply = data.content?.[0]?.text || '';

    // 🔥 Detect completion trigger
    const shouldSubmit = reply.includes("I’ve got it. I’ll send that through to Fiker.");

    return res.status(200).json({
      reply,
      done: shouldSubmit, // frontend will use this to trigger /api/feedback
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
