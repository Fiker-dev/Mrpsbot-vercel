// api/memory.js
// Reads and updates Lily / Mr P feedback memory in Vercel KV

import { kv } from '@vercel/kv';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeLimit(rawLimit, defaultValue = 10, maxValue = 50) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(Math.floor(parsed), maxValue);
}

function extractTimelineKey(client) {
  if (client && typeof client === 'string' && client.trim()) {
    return `feedback:timeline:${client.trim()}`;
  }
  return 'feedback:timeline';
}

async function getRecentItems(client, limit) {
  const key = extractTimelineKey(client);
  const raw = await kv.zrange(key, 0, limit - 1, { rev: true });

  return raw
    .map((item) => {
      if (typeof item === 'string') {
        return safeJsonParse(item, null);
      }
      return item;
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const client =
        typeof req.query?.client === 'string' ? req.query.client.trim() : '';
      const limit = normalizeLimit(req.query?.limit, 10, 50);

      const items = await getRecentItems(client, limit);

      return res.status(200).json({
        ok: true,
        client: client || null,
        count: items.length,
        items,
      });
    }

    if (req.method === 'PATCH') {
      const {
        id,
        status,
        title,
        category,
        priority,
        summary,
        details,
        user_message,
        source,
        client,
      } = req.body || {};

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Missing feedback id' });
      }

      const existing = await kv.get(`feedback:${id}`);

      if (!existing) {
        return res.status(404).json({ error: 'Feedback record not found' });
      }

      const updatedRecord = {
        ...existing,
        status:
          typeof status === 'string' && status.trim()
            ? status.trim()
            : existing.status,
        title:
          typeof title === 'string' && title.trim()
            ? title.trim()
            : existing.title,
        category:
          typeof category === 'string' && category.trim()
            ? category.trim()
            : existing.category,
        priority:
          typeof priority === 'string' && priority.trim()
            ? priority.trim()
            : existing.priority,
        summary:
          typeof summary === 'string' && summary.trim()
            ? summary.trim()
            : existing.summary,
        details:
          typeof details === 'string' && details.trim()
            ? details.trim()
            : existing.details,
        user_message:
          typeof user_message === 'string'
            ? user_message.trim()
            : existing.user_message,
        source:
          typeof source === 'string' && source.trim()
            ? source.trim()
            : existing.source,
        client:
          typeof client === 'string' && client.trim()
            ? client.trim()
            : existing.client || 'mr-p',
        updated_at: new Date().toISOString(),
      };

      // Update the main record
      await kv.set(`feedback:${id}`, updatedRecord);

      // Add the updated record back into the global timeline
      await kv.zadd('feedback:timeline', {
        score: Date.now(),
        member: JSON.stringify(updatedRecord),
      });

      // Add the updated record into the client timeline
      const clientKey = extractTimelineKey(updatedRecord.client);
      await kv.zadd(clientKey, {
        score: Date.now(),
        member: JSON.stringify(updatedRecord),
      });

      // Push to recent list too
      await kv.lpush('feedback_memory', JSON.stringify(updatedRecord));
      await kv.ltrim('feedback_memory', 0, 99);

      return res.status(200).json({
        ok: true,
        updated: true,
        item: updatedRecord,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Memory API error:', error);
    return res.status(500).json({
      error: 'Memory API failed',
      detail: error?.message || 'Unknown error',
    });
  }
}
