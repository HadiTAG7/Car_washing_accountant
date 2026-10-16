import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: null, businessReads: 0 }));
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: {}, getFirestore: () => ({ collection: name => {
  if (!['users', 'app_admins'].includes(name)) { state.businessReads++; throw new Error('Synthetic test forbids business access'); }
  return { doc: () => ({ get: async () => ({ exists: name === 'users', data: () => ({ role: state.role }) }) }) };
} }) }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (options, handler) => ({ options, handler }),
  HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }));

const functions = await import('../index.js');
const names = ['expenseCorrectionOptions', 'expensePreviewCorrection', 'expenseSaveCorrection', 'payrollReadStatus', 'workerRecordAdvance'];
beforeEach(() => { state.role = null; state.businessReads = 0; });
describe('existing workflow handlers are registered through the shared authenticated callable wrapper', () => {
  it.each(names)('%s rejects unauthorized callers before touching business data', async name => {
    expect(typeof functions[name]?.handler).toBe('function');
    expect(functions[name].options).toMatchObject({ region: 'us-central1', cors: true });
    await expect(functions[name].handler({ data: { role: 'admin', confirm: true } })).rejects.toMatchObject({ code: 'unauthenticated' });
    for (const role of ['supervisor', 'partner', 'operator', ...(name === 'workerRecordAdvance' ? ['accountant'] : [])]) {
      state.role = role;
      await expect(functions[name].handler({ auth: { uid: 'synthetic-caller', token: { role: 'admin', admin: true } },
        data: { role: 'admin', confirm: true } })).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect(state.businessReads).toBe(0);
  });
});
