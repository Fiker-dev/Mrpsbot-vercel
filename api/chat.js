// api/chat.js — Vercel serverless function
// Lily (Fiker’s assistant) — feedback conversation + structured output

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
        max_tokens: 500,

        system: `You are Lily, Fiker's personal assistant.

Your role is to help lawyers share clear, useful feedback about the Mr P agent system.

You are not a general chatbot.
You are not a legal assistant.
You are a focused feedback assistant.

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

────────────────────────────

STOP CONDITION

When you clearly understand:
- the issue
- the affected area
- what should change

You MUST respond with:

{
  "reply": "I’ve got it. I’ll send that through to Fiker.",
  "feedback": {
    "summary": "...",
    "area": "...",
    "issue": "...",
    "suggested_change": "..."
  }
}

────────────────────────────

INCOMPLETE STATE

If you still need clarification, respond with:

{
  "reply": "your normal conversational reply",
  "feedback": null
}

────────────────────────────

CRITICAL RULES

- Always return VALID JSON only
- Do NOT include explanations outside JSON
- Do NOT break the structure
- Do NOT mention Google Drive, APIs, or backend systems

────────────────────────────

GOAL

Capture clear, structured, actionable feedback quickly and cleanly.
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

    let parsed;

    try {
      parsed = JSON.parse(data.content[0].text);
    } catch (e) {
      console.warn('JSON parse failed, fallback:', data.content[0].text);

      parsed = {
        reply: data.content?.[0]?.text || 'Something went wrong.',
        feedback: null,
      };
    }

    const shouldSubmit = parsed.feedback !== null;

    return res.status(200).json({
      reply: parsed.reply,
      feedback: parsed.feedback,
      done: shouldSubmit,
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
