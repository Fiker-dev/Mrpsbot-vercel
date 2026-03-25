// api/chat.js — Vercel serverless function
// Receives messages from the Mr P bot and calls Claude

export default async function handler(req, res) {
  // CORS — allow your GitHub Pages domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 600,
        system: `You are Chanelle, Mr P's private legal assistant. You are professional, calm, and precise. 
You help with case awareness, drafting, summarising, Microsoft workspace tasks, and case intelligence.
Keep responses concise and direct. You do not reveal confidential information.
When someone asks about research, you explain that you delegate safely to Sofie.
Never break character. Always speak as Chanelle.`,
        messages: [{ role: 'user', content: message }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', data);
      return res.status(500).json({ error: 'Claude API error', detail: data });
    }

    return res.status(200).json({
      reply: data.content[0].text,
    });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
