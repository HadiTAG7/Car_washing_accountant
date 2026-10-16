import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { __setConnection, callAppServer } from '../src/client.js';
import { workflowReadTools, workflowWriteTools } from '../src/workflowTools.js';
const token = vi.fn(async () => 'synthetic-id-token');
beforeEach(() => { vi.unstubAllGlobals(); token.mockClear(); __setConnection({ auth: { currentUser: { getIdToken: token } } }); });
describe('workflow MCP adapter', () => {
  it('new workflows use only fixed authenticated app API; previews carry no write confirmation', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ result: { preview: true, previewHash: 'a'.repeat(64) } }) }));
    vi.stubGlobal('fetch', fetch);
    const request = { kind: 'variable', sourceId: 'e1', patch: { quantity: 50 } };
    const result = await workflowReadTools.find(t => t.name === 'sweater_preview_expense_correction').run(request);
    expect(JSON.parse(result.content[0].text).preview).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe('https://sweater-hadi-alghanim.vercel.app/api/ledger');
    const options = fetch.mock.calls[0][1];
    expect(options.redirect).toBe('error'); expect(options.headers.Authorization).toBe('Bearer synthetic-id-token');
    expect(JSON.parse(options.body)).toEqual({ name: 'expensePreviewCorrection', data: request });
  });
  it('forwards trusted refusals, not fake success or HTML/login response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: { code: 'permission-denied', message: 'Denied' } }) })));
    await expect(callAppServer('expenseSaveCorrection', {})).rejects.toMatchObject({ code: 'permission-denied', message: 'Denied' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => { throw Error('HTML'); } })));
    await expect(callAppServer('expenseSaveCorrection', {})).rejects.toMatchObject({ code: 'internal' });
  });
  it('network failure does not leak tokens and warns to verify before retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error('synthetic-id-token'); }));
    await expect(callAppServer('expenseSaveCorrection', {})).rejects.toMatchObject({ code: 'unavailable' });
    await expect(callAppServer('expenseSaveCorrection', {})).rejects.not.toThrow(/synthetic-id-token/);
  });
  it('requires explicit actual-payment confirmation; never calls payroll pay-all', async () => {
    const tool = workflowWriteTools.find(t => t.name === 'sweater_record_payroll_payment');
    expect(() => tool.run({ confirm: false })).toThrow();
    expect(z.object(tool.schema).safeParse({}).success).toBe(false);
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ result: { selectedCount: 1 } }) })); vi.stubGlobal('fetch', fetch);
    await tool.run({ runId: 'run-1', bikerIds: ['b1'], payDate: '2026-10-01', paymentMethod: 'cash', recordedNetAmount: 700, previewHash: 'a'.repeat(64), reason: 'Owner confirmed paid', confirm: true, recordedExternally: true });
    expect(JSON.parse(fetch.mock.calls[0][1].body).name).toBe('payrollRecordPartialPayment');
  });
  it('draft save is separate from approval/payment and returns the freshly calculated draft', async () => {
    const tool = workflowWriteTools.find(t => t.name === 'sweater_save_payroll_draft');
    expect(() => tool.run({ confirm: false })).toThrow();
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ result: { runId: 'synthetic-run', status: 'draft' } }) })); vi.stubGlobal('fetch', fetch);
    await tool.run({ periodKey: '2026-09', automaticAdvanceDeduction: true, confirm: true });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ name: 'payrollSaveDraft', data: { periodKey: '2026-09', automaticAdvanceDeduction: true } });
  });
  it('readonly mode blocks new mutations before connecting or networking, while preview works', async () => {
    vi.stubEnv('SWEATER_MCP_READONLY', '1'); vi.resetModules();
    const client = await import('../src/client.js'); client.__setConnection({ auth: { currentUser: { getIdToken: token } } });
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ result: { preview: true } }) })); vi.stubGlobal('fetch', fetch);
    await expect(client.callAppServer('expenseSaveCorrection', {})).rejects.toMatchObject({ code: 'permission-denied' }); expect(fetch).not.toHaveBeenCalled();
    expect(await client.callAppServer('expensePreviewCorrection', {}, { write: false })).toEqual({ preview: true });
    vi.unstubAllEnvs();
  });
});
