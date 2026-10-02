import { afterEach, describe, expect, it } from 'vitest';
import { authorizeAgentCommandSender, resolveAgentCommandSender } from '../../server/agentCommandCenterSenders.js';
import { normalizeAgentCommandEvent, signAgentCommandRequest, verifyAgentCommandSignature } from '../src/agentCommandCenter.js';

const secret = 'test-scoped-expense-sender-secret-0123456789';
const registry = JSON.stringify({ capture: { secret, agentIds: ['expense-capture'], sourceIds: ['google-drive'] }, review: { secret: `${secret}-review`, agentIds: ['expense-review'], sourceIds: [] } });
const body = Buffer.from('signed bytes');
const timestamp = String(Math.floor(Date.now() / 1000));
afterEach(() => { delete process.env.AGENT_COMMAND_CENTER_SENDERS; });

describe('Scoped agent identities', () => {
  it('disables the shared secret when scoped mode is configured and fails closed on invalid configuration', () => {
    expect(() => resolveAgentCommandSender(undefined, { AGENT_COMMAND_CENTER_SENDERS: registry, AGENT_COMMAND_CENTER_WEBHOOK_SECRET: secret })).toThrow();
    expect(() => resolveAgentCommandSender('capture', { AGENT_COMMAND_CENTER_SENDERS: '{' })).toThrow();
    expect(() => resolveAgentCommandSender('capture', { AGENT_COMMAND_CENTER_SENDERS: JSON.stringify({ capture: { secret, agentIds: ['ceo'], sourceIds: [] } }) })).toThrow();
    expect(resolveAgentCommandSender(undefined, { AGENT_COMMAND_CENTER_WEBHOOK_SECRET: secret })).toEqual({ secret });
  });
  it('rejects cross-agent and source impersonation', () => {
    const sender = resolveAgentCommandSender('capture', { AGENT_COMMAND_CENTER_SENDERS: registry });
    const common = { version: 1, occurredAt: new Date().toISOString(), eventType: 'status', status: 'healthy' };
    expect(() => authorizeAgentCommandSender(sender, normalizeAgentCommandEvent({ ...common, agentId: 'expense-capture', sourceIds: ['google-drive'] }))).not.toThrow();
    expect(() => authorizeAgentCommandSender(sender, normalizeAgentCommandEvent({ ...common, agentId: 'cfo' }))).toThrow();
    expect(() => authorizeAgentCommandSender(sender, normalizeAgentCommandEvent({ ...common, agentId: 'expense-capture', sourceIds: ['payroll'] }))).toThrow();
    expect(() => authorizeAgentCommandSender(sender, normalizeAgentCommandEvent({ version: 1, occurredAt: common.occurredAt, eventType: 'activity', activity: { message: 'test', kind: 'info' } }))).toThrow();
  });
  it('cryptographically binds sender identity as well as exact body and replay key', () => {
    const signature = signAgentCommandRequest(secret, { senderId: 'capture', timestamp, idempotencyKey: 'test-1', rawBody: body });
    expect(verifyAgentCommandSignature({ secret, senderId: 'capture', timestamp, idempotencyKey: 'test-1', rawBody: body, signature }).senderId).toBe('capture');
    expect(() => verifyAgentCommandSignature({ secret, senderId: 'review', timestamp, idempotencyKey: 'test-1', rawBody: body, signature })).toThrow();
  });
  it('requires real evidence for completed tasks and manager review, never accepts decision execution fields', () => {
    const common = { version: 1, occurredAt: new Date().toISOString(), agentId: 'expense-capture', caseId: 'case-1', eventType: 'task' };
    expect(() => normalizeAgentCommandEvent({ ...common, task: { title: 'مهمة', state: 'completed', result: 'انتهى' } })).toThrow();
    expect(normalizeAgentCommandEvent({ ...common, task: { title: 'مهمة', state: 'completed', result: 'انتهى', evidence: ['https://example.com/evidence'] } }).task.state).toBe('completed');
    expect(() => normalizeAgentCommandEvent({ ...common, task: { title: 'مهمة', state: 'blocked' } })).toThrow();
    expect(() => normalizeAgentCommandEvent({ ...common, task: { title: 'مهمة', state: 'running', approve: true } })).toThrow();
    expect(() => normalizeAgentCommandEvent({ ...common, eventType: 'report', report: { title: 'مراجعة', summary: 'ملخص', review: { results: 'نتيجة', exceptions: 'لا شيء', recommendation: 'قرار', evidence: ['https://example.com/report'] } } })).toThrow();
    expect(normalizeAgentCommandEvent({ ...common, agentId: 'cfo', eventType: 'report', report: { title: 'مراجعة', summary: 'ملخص', review: { results: 'نتيجة', exceptions: 'لا شيء', recommendation: 'قرار', evidence: ['https://example.com/report'] } } }).report.review.results).toBe('نتيجة');
  });
});
