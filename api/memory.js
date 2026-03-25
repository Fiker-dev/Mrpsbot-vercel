import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const itemsRaw = await kv.lrange('feedback_memory', 0, 49);
      const resolvedRaw = await kv.lrange('resolved_updates', 0, 49);

      const items = (itemsRaw || []).map((item) => {
        try {
          return typeof item === 'string' ? JSON.parse(item) : item;
        } catch {
          return item;
        }
      });

      const resolved = (resolvedRaw || []).map((item) => {
        try {
          return typeof item === 'string' ? JSON.parse(item) : item;
        } catch {
          return item;
        }
      });

      return res.status(200).json({
        items,
        resolved,
      });
    }

    if (req.method === 'PATCH') {
      const { id, status, fixed_note = '', resolved_by = 'dev-agent' } = req.body || {};

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
        resolved_by,
        updated_at: new Date().toISOString(),
        fixed_at: status === 'fixed' ? new Date().toISOString() : existing.fixed_at || null,
      };

      await kv.set(`feedback:${id}`, updated);

      // Also push to resolved updates feed for Lily to reference later
      if (status === 'fixed') {
        await kv.lpush(
          'resolved_updates',
          JSON.stringify({
            id: updated.id,
            summary: updated.summary,
            area: updated.area,
            issue: updated.issue,
            suggested_change: updated.suggested_change,
            fixed_note: updated.fixed_note,
            fixed_at: updated.fixed_at,
            resolved_by: updated.resolved_by,
          })
        );
        await kv.ltrim('resolved_updates', 0, 49);
      }

      return res.status(200).json({
        success: true,
        record: updated,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Memory error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
