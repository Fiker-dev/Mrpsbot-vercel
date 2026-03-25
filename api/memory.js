import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const items = await kv.zrange('feedback:timeline', 0, 9, { rev: true });
      const parsed = items.map((item) => {
        try {
          return typeof item === 'string' ? JSON.parse(item) : item;
        } catch {
          return item;
        }
      });
      return res.status(200).json({ items: parsed });
    }

    if (req.method === 'POST') {
      const {
        summary,
        area,
        issue,
        suggested_change = '',
        raw_feedback = '',
        source = 'unknown',
        email = null
      } = req.body || {};

      if (!summary || !area || !issue) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const record = {
        id,
        summary,
        area,
        issue,
        suggested_change,
        raw_feedback,
        source,
        email,
        status: 'pending',
        created_at: now,
        updated_at: now,
        fixed_note: ''
      };

      await kv.set(`feedback:${id}`, record);
      await kv.zadd('feedback:timeline', {
        score: Date.now(),
        member: JSON.stringify(record)
      });

      return res.status(200).json({ success: true, record });
    }

    if (req.method === 'PATCH') {
      const { id, status, fixed_note = '' } = req.body || {};

      if (!id || !status) {
        return res.status(400).json({ error: 'Missing id or status' });
      }

      const existing = await kv.get(`feedback:${id}`);
      if (!existing) {
        return res.status(404).json({ error: 'Record not found' });
      }

      const updated = {
        ...existing,
        status,
        fixed_note,
        updated_at: new Date().toISOString()
      };

      await kv.set(`feedback:${id}`, updated);
      return res.status(200).json({ success: true, record: updated });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('memory.js error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
