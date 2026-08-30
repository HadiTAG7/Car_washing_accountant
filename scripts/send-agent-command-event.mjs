import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { signAgentCommandRequest } from '../functions/src/agentCommandCenter.js';

const DEFAULT_ENDPOINT = 'https://monster-wash-erp.vercel.app/api/agent-command-center-ingest';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    fail('الاستخدام: npm run agents:send -- <event.json>');
    return;
  }

  const secret = process.env.AGENT_COMMAND_CENTER_WEBHOOK_SECRET;
  if (!secret) {
    fail('AGENT_COMMAND_CENTER_WEBHOOK_SECRET غير مضبوط في بيئة التشغيل.');
    return;
  }

  const endpoint = process.env.AGENT_COMMAND_CENTER_ENDPOINT || DEFAULT_ENDPOINT;
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== 'https:' || parsedEndpoint.username || parsedEndpoint.password) {
    fail('AGENT_COMMAND_CENTER_ENDPOINT يجب أن يكون رابط HTTPS بلا بيانات دخول.');
    return;
  }

  const rawBody = await readFile(resolve(payloadPath));
  JSON.parse(rawBody.toString('utf8'));
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const idempotencyKey = process.env.AGENT_COMMAND_CENTER_IDEMPOTENCY_KEY
    || `event:${createHash('sha256').update(rawBody).digest('hex')}`;
  const signature = signAgentCommandRequest(secret, { timestamp, idempotencyKey, rawBody });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sweater-Timestamp': timestamp,
      'X-Sweater-Idempotency-Key': idempotencyKey,
      'X-Sweater-Signature': `sha256=${signature}`,
    },
    body: rawBody,
  });
  const result = await response.json().catch(() => ({ ok: false, error: 'invalid-response' }));
  if (!response.ok || !result.ok) {
    fail(`فشل إرسال الحدث: HTTP ${response.status} (${result.error || 'unknown'})`);
    return;
  }
  process.stdout.write(`تم قبول الحدث ${result.eventId}${result.duplicate ? ' (مكرر)' : ''}.\n`);
}

main().catch((error) => fail(`تعذر إرسال الحدث: ${error.message}`));
