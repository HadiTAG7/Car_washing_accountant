import { beforeEach, describe, it, expect, vi } from 'vitest';
import { financeFixture } from '../../server/__tests__/financeFixtures';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), connect: vi.fn(), readOnly: false }));
vi.mock('../src/client.js', () => ({ connect: (...args) => mocks.connect(...args), get readOnly() { return mocks.readOnly; },
  SweaterMcpError: class extends Error { constructor(message, info = {}) { super(message); this.code = info.code; } } }));
import { callFinanceServer, financeReadTools, financeWriteTools } from '../src/financeTools';
beforeEach(() => { mocks.fetch.mockReset(); mocks.connect.mockReset(); mocks.readOnly = false; vi.stubGlobal('fetch', mocks.fetch);
  mocks.connect.mockResolvedValue({ auth: { currentUser: { getIdToken: async () => 'SYNTHETIC-TOKEN' } } }); });
const result = value => ({ ok: true, json: async () => ({ result: value }) });
describe('finance MCP uses the same authenticated application service', () => {
  it('has read-only previews and explicit write confirmation schemas', () => {
    expect(financeReadTools.every(t => t.annotations.readOnlyHint)).toBe(true);
    for (const tool of financeWriteTools) expect(tool.schema.confirm.safeParse(false).success).toBe(false);
    expect(financeWriteTools.map(t => t.name)).toEqual(['sweater_publish_finance_report', 'sweater_finance_workbench_save']);
  });
  it('never permits a model-controlled origin or direct database write', async () => {
    await expect(callFinanceServer('https://example.org', {})).rejects.toThrow(); expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue(result({ items: [] })); await callFinanceServer('finance-reports', { action: 'list' });
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://sweater-hadi-alghanim.vercel.app/api/finance-reports');
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer SYNTHETIC-TOKEN');
  });
  it('refuses writes before even signing in when read-only', async () => {
    mocks.readOnly = true; await expect(callFinanceServer('finance-workbench', {}, { write: true })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('publishes a reviewed report then reads the exact saved revision', async () => {
    const report = financeFixture(); mocks.fetch.mockResolvedValueOnce(result({ revision: 1 })).mockResolvedValueOnce(result({ report }));
    const output = await financeWriteTools[0].run({ report, expectedRevision: 0, confirm: true });
    expect(JSON.parse(output.content[0].text).verified).toBe(true);
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({ action: 'read', reportId: report.reportId, revision: 1 });
  });
  it('does not call an unrelated report financial action and fails closed on changed read-back', async () => {
    const report = financeFixture(); mocks.fetch.mockResolvedValueOnce(result({ revision: 1 })).mockResolvedValueOnce(result({ report: { ...report, summary: 'تغير' } }));
    await expect(financeWriteTools[0].run({ report, expectedRevision: 0, confirm: true })).rejects.toThrow(/تتطابق/);
    expect(mocks.fetch.mock.calls.every(([url]) => url.endsWith('/finance-reports'))).toBe(true);
  });
  it('does not declare an expense saved when its source hash changed', async () => {
    mocks.fetch.mockResolvedValueOnce(result({ sourceId: 'TEST', sourceHash: 'first' })).mockResolvedValueOnce(result({ sourceId: 'TEST', sourceHash: 'changed' }));
    await expect(financeWriteTools[1].run({ action: 'save', request: { kind: 'variable' }, confirm: true })).rejects.toThrow(/تتطابق/);
  });
  it('does not blindly retry a network failure or ignore HTTP authorization errors', async () => {
    mocks.fetch.mockRejectedValue(new Error('Synthetic offline')); await expect(callFinanceServer('finance-reports', {})).rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.fetch).toHaveBeenCalledTimes(1); mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: { code: 'permission-denied', message: 'مرفوض' } }) });
    await expect(callFinanceServer('finance-reports', {})).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
