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
      const id =
        typeof req.query?.id === 'string' ? req.query.id.trim() : '';
      if (id) {
        const item = await kv.get(`feedback:${id}`);
        if (!item) {
          return res.status(404).json({ error: 'Feedback record not found' });
        }

        return res.status(200).json({
          ok: true,
          item,
        });
      }

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
        user_email,
        source,
        client,
        developer_summary,
        triage_status,
        triage_model,
        triage_error,
        routing,
        qa_status,
        qa_summary,
        qa_task,
        coding_status,
        fix_prompt,
        fix_summary,
        repo_target,
        repo_context,
        architecture_constraints,
        repro_status,
        repro_steps,
        observed_result,
        expected_result,
        technical_evidence,
        confidence,
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
        user_email:
          typeof user_email === 'string' && user_email.trim()
            ? user_email.trim()
            : existing.user_email,
        source:
          typeof source === 'string' && source.trim()
            ? source.trim()
            : existing.source,
        developer_summary:
          typeof developer_summary === 'string' && developer_summary.trim()
            ? developer_summary.trim()
            : existing.developer_summary,
        triage_status:
          typeof triage_status === 'string' && triage_status.trim()
            ? triage_status.trim()
            : existing.triage_status,
        triage_model:
          typeof triage_model === 'string' && triage_model.trim()
            ? triage_model.trim()
            : existing.triage_model,
        triage_error:
          typeof triage_error === 'string'
            ? triage_error.trim()
            : existing.triage_error,
        routing:
          typeof routing === 'string' && routing.trim()
            ? routing.trim()
            : existing.routing,
        qa_status:
          typeof qa_status === 'string' && qa_status.trim()
            ? qa_status.trim()
            : existing.qa_status,
        qa_summary:
          typeof qa_summary === 'string' && qa_summary.trim()
            ? qa_summary.trim()
            : existing.qa_summary,
        qa_task:
          typeof qa_task === 'string' && qa_task.trim()
            ? qa_task.trim()
            : existing.qa_task,
        coding_status:
          typeof coding_status === 'string' && coding_status.trim()
            ? coding_status.trim()
            : existing.coding_status,
        fix_prompt:
          typeof fix_prompt === 'string' && fix_prompt.trim()
            ? fix_prompt.trim()
            : existing.fix_prompt,
        fix_summary:
          typeof fix_summary === 'string' && fix_summary.trim()
            ? fix_summary.trim()
            : existing.fix_summary,
        repo_target:
          typeof repo_target === 'string' && repo_target.trim()
            ? repo_target.trim()
            : existing.repo_target,
        repo_context:
          typeof repo_context === 'string' && repo_context.trim()
            ? repo_context.trim()
            : existing.repo_context,
        architecture_constraints:
          typeof architecture_constraints === 'string' && architecture_constraints.trim()
            ? architecture_constraints.trim()
            : existing.architecture_constraints,
        repro_status:
          typeof repro_status === 'string' && repro_status.trim()
            ? repro_status.trim()
            : existing.repro_status,
        repro_steps:
          typeof repro_steps === 'string' && repro_steps.trim()
            ? repro_steps.trim()
            : existing.repro_steps,
        observed_result:
          typeof observed_result === 'string' && observed_result.trim()
            ? observed_result.trim()
            : existing.observed_result,
        expected_result:
          typeof expected_result === 'string' && expected_result.trim()
            ? expected_result.trim()
            : existing.expected_result,
        technical_evidence:
          typeof technical_evidence === 'string' && technical_evidence.trim()
            ? technical_evidence.trim()
            : existing.technical_evidence,
        confidence:
          typeof confidence === 'string' && confidence.trim()
            ? confidence.trim()
            : existing.confidence,
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
