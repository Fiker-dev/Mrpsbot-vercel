import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

function toDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

async function loadHelperModule() {
  const source = await readFile(new URL('../api/feedback-helpers.js', import.meta.url), 'utf8');
  return import(toDataUrl(source));
}

async function loadHandlerModule(fileName, replacements) {
  const fileUrl = new URL(`../api/${fileName}`, import.meta.url);
  let source = await readFile(fileUrl, 'utf8');

  for (const [from, to] of replacements) {
    source = source.replace(from, to);
  }

  return import(toDataUrl(source));
}

async function main() {
  process.env.RESEND_API_KEY = 'test-resend-key';

  const helperUrl = toDataUrl(await readFile(new URL('../api/feedback-helpers.js', import.meta.url), 'utf8'));
  const helperModule = await import(helperUrl);

  const kvOps = [];
  const kvStore = new Map();
  const kvMock = {
    async lpush(key, value) {
      kvOps.push(['lpush', key, value]);
    },
    async lrange() {
      return [];
    },
    async ltrim(key, start, end) {
      kvOps.push(['ltrim', key, start, end]);
    },
    async set(key, value) {
      kvStore.set(key, value);
      kvOps.push(['set', key, value]);
    },
    async get(key) {
      kvOps.push(['get', key]);
      return kvStore.get(key) ?? null;
    },
  };

  const kvMockUrl = toDataUrl(`
    export const kv = globalThis.__kvMock;
  `);

  globalThis.__kvMock = kvMock;
  const resendCalls = [];
  globalThis.fetch = async (url, options) => {
    resendCalls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { id: `email_${resendCalls.length}` };
      },
    };
  };

  const feedbackModule = await loadHandlerModule('feedback.js', [
    ["import { kv } from '@vercel/kv';", `import { kv } from '${kvMockUrl}';`],
    ["from './feedback-helpers.js';", `from '${helperUrl}';`],
  ]);

  const vagueValidation = helperModule.validateFeedbackDraft("She's hallucinating again.", {
    summary: "Lana is hallucinating.",
    area: 'Lana chat handoff',
    issue: 'This happens in the Lana chat handoff when she closes too early.',
    suggested_change: '',
  });
  assert.equal(vagueValidation.ok, false);
  assert.equal(vagueValidation.reason, 'missing_location');

  const repeatedUnresolved = helperModule.detectRepeatIssue(
    'Lana is still hallucinating in the chat.',
    [
      {
        id: 'fb-1',
        status: 'pending',
        summary: 'Lana is hallucinating in the chat.',
        issue: 'She gives made-up answers in the Lana chat.',
        raw_feedback: 'Lana is hallucinating in the chat.',
      },
    ],
    []
  );
  assert.equal(repeatedUnresolved.repeated, true);
  assert.equal(repeatedUnresolved.recently_fixed, false);
  assert.equal(repeatedUnresolved.repeat_type, 'pending_repeat');
  assert.equal(repeatedUnresolved.hint, 'already raised and not yet marked fixed');
  assert.equal(repeatedUnresolved.match.repeat_count, 1);

  const repeatedAfterFix = helperModule.detectRepeatIssue(
    'Lana is still hallucinating in the chat.',
    [],
    [
      {
        id: 'fb-2',
        status: 'fixed',
        summary: 'Lana is hallucinating in the chat.',
        issue: 'She gives made-up answers in the Lana chat.',
        raw_feedback: 'Lana is hallucinating in the chat.',
        fixed_note: 'Tightened the prompt.',
        fixed_at: '2026-04-06T20:00:00.000Z',
      },
    ]
  );
  assert.equal(repeatedAfterFix.repeated, true);
  assert.equal(repeatedAfterFix.recently_fixed, true);
  assert.equal(repeatedAfterFix.still_happening_after_fix, true);
  assert.equal(repeatedAfterFix.repeat_type, 'reopened_after_fix');
  assert.equal(repeatedAfterFix.match.repeat_count, 1);

  const feedbackReq = {
    method: 'POST',
    body: {
      message: JSON.stringify({
        summary: "Lana says she's got enough too early.",
        area: 'Lana chat handoff',
        issue: 'She closes the conversation before the problem and location are both clear.',
        suggested_change: '',
        raw_feedback: "Lana says she's got enough too early.",
        user_quote: "Lana says she's got enough too early.",
      }),
      email: 'mrp@example.com',
      source: 'mrpsagentguide.lulidigital.com',
    },
  };
  const feedbackRes = createResponse();
  await feedbackModule.default(feedbackReq, feedbackRes);

  assert.equal(feedbackRes.statusCode, 200);
  assert.equal(feedbackRes.body.success, true);
  assert.ok(feedbackRes.body.reference.startsWith('MRP-'));
  assert.equal(feedbackRes.body.route, 'qa');
  assert.equal(resendCalls.length, 2);
  const submitAdminEmail = JSON.parse(resendCalls[0].options.body);
  const submitUserEmail = JSON.parse(resendCalls[1].options.body);
  assert.match(submitAdminEmail.text, /Route: qa \((quality_or_accuracy_review|default_review_gate)\)/);
  assert.equal(submitUserEmail.subject, "Lana update: I've submitted your feedback");
  assert.match(submitUserEmail.text, /Lana here\. I've submitted your feedback\./);
  assert.match(submitUserEmail.text, /Feedback received:/);
  assert.match(submitUserEmail.text, /"Lana says she's got enough too early\."/);
  assert.match(submitUserEmail.text, /Reference number: MRP-/);
  assert.match(submitUserEmail.text, /We will notify you once it's fixed\./);

  const savedRecord = kvStore.get(`feedback:${feedbackRes.body.id}`);
  assert.equal(savedRecord.raw_feedback, "Lana says she's got enough too early.");
  assert.equal(savedRecord.submit_notifications.user.email, 'mrp@example.com');
  assert.equal(savedRecord.submit_notifications.user.subject, "Lana update: I've submitted your feedback");
  assert.match(savedRecord.submit_notifications.user.preview, /Lana here\. I've submitted your feedback\./);
  assert.match(savedRecord.submit_notifications.user.id, /^email_/);
  assert.equal(savedRecord.repeat_type, null);
  assert.deepEqual(savedRecord.related_feedback_ids, []);
  assert.equal(savedRecord.reopens_reference, null);
  assert.ok(
    kvOps.some(
      ([op, key, value]) =>
        op === 'lpush' &&
        key === 'notifications_outbox' &&
        String(value).includes('"feedback_submitted"')
    )
  );
  assert.equal(savedRecord.submission_fingerprint.length, 64);

  const duplicateRes = createResponse();
  await feedbackModule.default(feedbackReq, duplicateRes);
  assert.equal(duplicateRes.statusCode, 200);
  assert.equal(duplicateRes.body.duplicate, true);
  assert.equal(duplicateRes.body.id, feedbackRes.body.id);
  assert.equal(resendCalls.length, 2);

  const olderPendingRecord = {
    ...savedRecord,
    created_at: '2026-03-01T12:00:00.000Z',
    updated_at: '2026-03-01T12:00:00.000Z',
  };
  kvStore.set(`feedback:${feedbackRes.body.id}`, olderPendingRecord);
  globalThis.__kvMock.lrange = async (key) => {
    if (key === 'feedback_memory') {
      return [JSON.stringify(olderPendingRecord)];
    }
    if (key === 'resolved_updates') {
      return [];
    }
    return [];
  };

  const repeatedSameFeedbackRes = createResponse();
  await feedbackModule.default(feedbackReq, repeatedSameFeedbackRes);
  assert.equal(repeatedSameFeedbackRes.statusCode, 200);
  assert.notEqual(repeatedSameFeedbackRes.body.id, feedbackRes.body.id);
  assert.equal(repeatedSameFeedbackRes.body.duplicate, undefined);
  assert.equal(resendCalls.length, 4);
  const repeatedSameRecord = kvStore.get(`feedback:${repeatedSameFeedbackRes.body.id}`);
  assert.equal(repeatedSameRecord.repeat_type, 'pending_repeat');
  assert.equal(repeatedSameRecord.repeat_count, 2);
  assert.deepEqual(repeatedSameRecord.related_feedback_ids, [feedbackRes.body.id]);
  assert.equal(repeatedSameRecord.reopens_reference, null);
  const repeatedSameUserEmail = JSON.parse(resendCalls[3].options.body);
  assert.equal(repeatedSameUserEmail.subject, "Lana update: I've submitted this again for another look");
  assert.match(repeatedSameUserEmail.text, /Lana here\. I can see you're still having trouble with this, so I've submitted it again\./);
  assert.match(repeatedSameUserEmail.text, /Feedback received:/);
  assert.match(repeatedSameUserEmail.text, /We will notify you once it's fixed\./);

  globalThis.__kvMock.lrange = async () => [];

  const memoryModule = await loadHandlerModule('memory.js', [
    ["import { kv } from '@vercel/kv';", `import { kv } from '${kvMockUrl}';`],
    ["from './feedback-helpers.js';", `from '${helperUrl}';`],
  ]);

  const memoryReq = {
    method: 'PATCH',
    body: {
      id: feedbackRes.body.id,
      status: 'fixed',
      fixed_note: 'Adjusted Lana so she asks one locating question before closing.',
      resolved_by: 'coding-agent',
    },
  };
  const memoryRes = createResponse();
  await memoryModule.default(memoryReq, memoryRes);

  assert.equal(memoryRes.statusCode, 200);
  assert.equal(memoryRes.body.success, true);
  assert.equal(memoryRes.body.record.status, 'fixed');
  assert.equal(resendCalls.length, 6);
  const fixedAdminEmail = JSON.parse(resendCalls[4].options.body);
  const fixedUserEmail = JSON.parse(resendCalls[5].options.body);
  assert.match(fixedAdminEmail.text, /Feedback fixed: MRP-/);
  assert.match(fixedUserEmail.text, /Your feedback "Lana says she's got enough too early\." has now been fixed\./);
  assert.match(fixedUserEmail.text, /Reference number: MRP-/);
  assert.match(fixedUserEmail.text, /Please try again\./);
  assert.match(fixedUserEmail.text, /don't hesitate to submit another feedback note/i);

  const fixedRecord = kvStore.get(`feedback:${feedbackRes.body.id}`);
  assert.equal(fixedRecord.fixed_notifications.user.email, 'mrp@example.com');
  assert.match(fixedRecord.fixed_notifications.user.id, /^email_/);
  assert.ok(
    kvOps.some(
      ([op, key, value]) =>
        op === 'lpush' &&
        key === 'notifications_outbox' &&
        String(value).includes('"feedback_fixed"')
    )
  );

  const duplicateFixedRes = createResponse();
  await memoryModule.default(memoryReq, duplicateFixedRes);
  assert.equal(duplicateFixedRes.statusCode, 200);
  assert.equal(duplicateFixedRes.body.duplicate, true);
  assert.equal(resendCalls.length, 6);

  globalThis.__kvMock.lrange = async (key) => {
    if (key === 'feedback_memory') {
      return [];
    }
    if (key === 'resolved_updates') {
      return [
        JSON.stringify({
          id: 'older',
          reference_number: 'MRP-OLDER01',
          status: 'fixed',
          summary: 'Lana is hallucinating in the chat.',
          issue: 'She gives made-up answers in the Lana chat.',
          raw_feedback: 'Lana is hallucinating in the chat.',
          fixed_note: 'Tightened the prompt.',
          fixed_at: '2026-04-06T20:00:00.000Z',
        }),
      ];
    }
    return [];
  };

  const repeatedFeedbackReq = {
    method: 'POST',
    body: {
      message: JSON.stringify({
        summary: 'Lana is still hallucinating in the chat.',
        area: 'Lana chat',
        issue: 'She is still giving made-up answers in the chat after the fix.',
        suggested_change: '',
        raw_feedback: 'Lana is still hallucinating in the chat.',
        user_quote: 'Lana is still hallucinating in the chat.',
      }),
      email: 'mrp@example.com',
      source: 'mrpsagentguide.lulidigital.com',
    },
  };
  const repeatedFeedbackRes = createResponse();
  await feedbackModule.default(repeatedFeedbackReq, repeatedFeedbackRes);
  assert.equal(repeatedFeedbackRes.statusCode, 200);
  const repeatedRecord = kvStore.get(`feedback:${repeatedFeedbackRes.body.id}`);
  assert.equal(repeatedRecord.repeat_type, 'reopened_after_fix');
  assert.equal(repeatedRecord.reopens_reference, 'MRP-OLDER01');
  assert.deepEqual(repeatedRecord.related_feedback_ids, ['older']);
  assert.equal(repeatedRecord.repeat_count, 2);
  const reopenedUserEmail = JSON.parse(resendCalls[7].options.body);
  assert.equal(reopenedUserEmail.subject, "Lana update: I've submitted this again for another look");
  assert.match(reopenedUserEmail.text, /Lana here\. I noticed this has happened again, so I've sent it back for another look\./);
  assert.match(reopenedUserEmail.text, /Feedback received:/);
  assert.match(reopenedUserEmail.text, /We will notify you once it's fixed\./);

  console.log(
    JSON.stringify(
      {
        submitted_reference: feedbackRes.body.reference,
        route: feedbackRes.body.route,
        resend_calls: resendCalls.length,
        duplicate_submit: duplicateRes.body.duplicate,
        duplicate_fix: duplicateFixedRes.body.duplicate,
        repeat_type: repeatedRecord.repeat_type,
        fixed_status: memoryRes.body.record.status,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
