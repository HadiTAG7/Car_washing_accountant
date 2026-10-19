import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { operationsFixture } from '../../server/__tests__/operationsFixture.js';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), connect: vi.fn(), readOnly: false }));
vi.mock('../src/client.js', () => ({ connect: (...args) => mocks.connect(...args), get readOnly() { return mocks.readOnly; },
  SweaterMcpError: class extends Error { constructor(message, info = {}) { super(message); this.code = info.code; } } }));
import { operationsReportReadTools, operationsReportWriteTools } from '../src/operationsReportTools.js';
beforeEach(() => { mocks.fetch.mockReset(); mocks.connect.mockReset(); mocks.readOnly = false; vi.stubGlobal('fetch', mocks.fetch);
  mocks.connect.mockResolvedValue({ auth: { currentUser: { getIdToken: async () => 'SYNTHETIC-TOKEN' } } }); });
afterEach(() => vi.unstubAllGlobals());
const result = value => ({ ok: true, json: async () => ({ result: value }) });
it('reads only fixed same-app service and validates explicit publication confirmation', async () => {
  expect(operationsReportReadTools[0].annotations.readOnlyHint).toBe(true); expect(operationsReportWriteTools[0].schema.confirm.safeParse(false).success).toBe(false);
  mocks.fetch.mockResolvedValue(result({ items: [] })); await operationsReportReadTools[0].run({ action: 'list' });
  expect(mocks.fetch.mock.calls[0][0]).toBe('https://sweater-hadi-alghanim.vercel.app/api/operations-reports');
});
it('refuses read-only publication without login or writes', async () => {
  mocks.readOnly = true; await expect(operationsReportWriteTools[0].run({ report: operationsFixture(), expectedRevision: 0 })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
});
it('checks receipt and rereads exact saved content; rejects a changed readback', async () => {
  const report = operationsFixture(), receipt = { reportId: report.reportId, revision: 1, duplicate: false };
  mocks.fetch.mockResolvedValueOnce(result(receipt)).mockResolvedValueOnce(result({ report }));
  expect(JSON.parse((await operationsReportWriteTools[0].run({ report, expectedRevision: 0 })).content[0].text).verified).toBe(true);
  expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({ action: 'read', reportId: report.reportId, revision: 1 });
  mocks.fetch.mockResolvedValueOnce(result(receipt)).mockResolvedValueOnce(result({ report: { ...report, summary: 'تغير غير متوقع' } }));
  await expect(operationsReportWriteTools[0].run({ report, expectedRevision: 0 })).rejects.toThrow(/تتطابق/);
});
