// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DuplicateCancellations, CustodySettlements } from '../founding/FoundingCorrections';
afterEach(cleanup);
const plain = text => text.replace(/[\u200e\u200f]/g, '').replace(/\u00a0/g, ' ');
const row = (key, title, amount, extra = {}) => ({ key, kind: 'startup', sourceId: key.split(':')[1], title, amount, date: '2026-08-12', supplier: 'مورد', protected: true, duplicate: null, ...extra });
const settings = { cutoffDate: '2026-10-01', foundingEnd: '2026-09-30' };
const founding = (plan, extra = {}) => ({ busy: false, act: vi.fn().mockResolvedValue(true), data: { plan: { settings, entries: [], rows: [], cancelled: [], custodyItems: [], ...plan }, ...extra } });
const confirm = async (label) => { fireEvent.click(screen.getByRole('button', { name: label })); fireEvent.click(within(screen.getByRole('group', { name: label })).getByRole('button', { name: 'تأكيد' })); };

describe('«إلغاء مستند مكرر» on the founding page', () => {
  it('picks a posted document and the original it duplicates, then saves a proposal with the written reason', async () => {
    const f = founding({ rows: [row('startup:se1', 'تجهيز المغسلة', 1000), row('startup:se2', 'تجهيز مكرر', 1000),
      row('variable:v1', 'أدوات غير مرحّلة', 230, { kind: 'variable', protected: false }), row('startup:se3', 'مختلف', 400)] });
    render(<DuplicateCancellations founding={f} names={{}} />);
    const pick = screen.getByLabelText('المستند المكرر (مرحّل)');
    expect([...pick.options].map(o => o.value)).toEqual(['', 'startup:se1', 'startup:se2', 'startup:se3']);
    fireEvent.change(pick, { target: { value: 'startup:se2' } });
    const original = screen.getByLabelText('المستند الأصلي اللي يكرره');
    expect([...within(original).getByRole('group', { name: 'بنفس المبلغ' }).querySelectorAll('option')].map(o => o.value)).toEqual(['startup:se1']);
    fireEvent.change(original, { target: { value: 'startup:se3' } });
    expect(screen.getByRole('note').textContent).toContain('المبلغان مختلفان');
    fireEvent.change(original, { target: { value: 'startup:se1' } });
    expect(screen.queryByRole('note')).toBe(null);
    expect(screen.getByRole('button', { name: 'حفظ الإلغاء قيدًا مقترحًا' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('السبب'), { target: { value: 'نفس الفاتورة سُجّلت مرتين' } });
    await confirm('حفظ الإلغاء قيدًا مقترحًا');
    await waitFor(() => expect(f.act).toHaveBeenCalled());
    expect(f.act.mock.calls[0][0]).toEqual({ action: 'proposeDuplicate', key: 'startup:se2', originalKey: 'startup:se1', reason: 'نفس الفاتورة سُجّلت مرتين', confirm: true });
  });

  it('lists proposals with what they reverse, withdraws an unposted one, and lists the cancelled documents', async () => {
    const entry = (status, extra = {}) => ({ key: 'duplicate:startup:se2', type: 'duplicate', id: 'dup_0123456789abcdef', title: 'إلغاء مستند مكرر: تجهيز مكرر',
      originalTitle: 'تجهيز المغسلة', amount: 1000, status, reason: 'نفس الفاتورة', proposedByName: 'هادي', proposedAtIso: '2026-10-30T10:00:00Z',
      sources: [{ entryNumber: 5, label: 'قيد المستند' }, { entryNumber: 7, label: '«تصحيح جهة دفع»' }],
      lines: [{ accountId: '2300', debit: 1000, credit: 0, description: 'عكس #7' }, { accountId: '1500', debit: 0, credit: 1000, description: 'عكس #5' }], ...extra });
    const f = founding({ entries: [entry('proposed')] });
    const { rerender } = render(<DuplicateCancellations founding={f} names={{}} />);
    expect(plain(screen.getByRole('listitem').textContent)).toContain('يعكس: قيد المستند #5، «تصحيح جهة دفع» #7');
    await confirm('حذف');
    await waitFor(() => expect(f.act).toHaveBeenCalledWith({ action: 'removeDuplicate', id: 'dup_0123456789abcdef', confirm: true }, 'حُذف الاقتراح.'));
    rerender(<DuplicateCancellations founding={founding({ entries: [entry('posted', { entryNumber: 20 })],
      cancelled: [{ key: 'startup:se2', title: 'تجهيز مكرر', amount: 1000, date: '2026-08-12', originalTitle: 'تجهيز المغسلة', entryNumber: 20 }] })} names={{}} />);
    expect(screen.queryByRole('button', { name: 'حذف' })).toBe(null);
    expect(screen.getByText(/ملغاة — مكررة \(1\)/)).toBeTruthy();
    expect(plain(screen.getAllByRole('listitem').at(-1).textContent)).toContain('ملغى — مكرر لـ«تجهيز المغسلة»');
  });
});

describe('«تسوية مصروف مؤقت» on the founding page', () => {
  it('previews Dr expense / Cr 1300 dated on the last founding day for an item before the cutoff, and saves a proposal', async () => {
    const f = founding({ custodyItems: [{ id: 't1', title: 'عهدة وقود', holder: 'سالم', outstanding: 300, spentDate: '2026-08-15', postingDate: '2026-09-30', entryNumber: 11 }] },
      { expenseAccounts: [{ code: '5100', name: 'تشغيل' }, { code: '5300', name: 'المصروفات الإدارية' }] });
    render(<CustodySettlements founding={f} names={{ 1300: 'عهد', 5300: 'المصروفات الإدارية' }} />);
    expect(screen.getByLabelText('حساب المصروف').value).toBe('5300');
    fireEvent.change(screen.getByLabelText('البند المؤقت (مرحّل على 1300)'), { target: { value: 't1' } });
    expect(plain(screen.getByText(/تاريخ القيد/).textContent)).toContain('2026-09-30 (البند 2026-08-15 قبل القطع)');
    const cells = [...screen.getByRole('table').querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => plain(td.textContent)));
    expect(cells[0][0]).toContain('5300'); expect(cells[0][2]).toContain('300.00');
    expect(cells[1][0]).toContain('1300'); expect(cells[1][3]).toContain('300.00');
    fireEvent.change(screen.getByLabelText('السبب'), { target: { value: 'صُرفت على المشروع ولا تُسترد' } });
    await confirm('حفظ التسوية قيدًا مقترحًا');
    await waitFor(() => expect(f.act).toHaveBeenCalled());
    expect(f.act.mock.calls[0][0]).toEqual({ action: 'proposeCustodySettlement', advanceId: 't1', accountId: '5300', reason: 'صُرفت على المشروع ولا تُسترد', confirm: true });
  });
});

describe('a temporary item settled by the founding entry, on the advances tab', () => {
  it('reads «سُوّيت بقيد تسوية مصروف», apart from items settled by expense documents', async () => {
    const { mapTemporaryExpense } = await import('../../lib/mappers');
    const { temporaryProposals } = await import('../../lib/administrationClassification');
    const { default: TemporaryProposalTable } = await import('../TemporaryProposalTable');
    const settled = (id, kind) => mapTemporaryExpense({ id, title: `عهدة ${id}`, amount: 300, spent_date: '2026-08-15', status: 'recovered', recovered_amount: 300,
      recovered_date: '2026-09-30', recovery_method: 'expense_document', document_recoveries: [{ kind, sourceId: 'x', entryId: 'e', amount: 300, date: '2026-09-30' }] });
    expect(settled('t1', 'founding').settledByEntry).toBe(true);
    expect(settled('t2', 'variable').settledByEntry).toBe(false);
    render(<TemporaryProposalTable rows={temporaryProposals([settled('t1', 'founding'), settled('t2', 'variable')])} />);
    const [byEntry, byDocument] = screen.getAllByRole('row').slice(1).map(r => plain(r.textContent));
    expect(byEntry).toContain('سُوّيت بقيد تسوية مصروف');
    expect(byEntry).toContain('منه بقيد تسوية مصروف');
    expect(byDocument).toContain('سُوّيت بمستندات مصروف');
  });
});
