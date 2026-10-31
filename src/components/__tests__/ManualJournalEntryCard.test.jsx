// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ManualJournalEntryCard from '../ManualJournalEntryCard';
const mock = vi.hoisted(() => ({ api: vi.fn(), read: null }));
vi.mock('../../lib/financeApi', () => ({ callFinanceApi: (...args) => mock.api(...args) }));
vi.mock('../../hooks/useFinanceRead', () => ({ useFinanceRead: () => mock.read }));
afterEach(cleanup);
beforeEach(() => {
  mock.api.mockReset();
  mock.read = { allowed: true, loading: false, error: null, refresh: vi.fn(), data: { partners: [{ id: 'p2', name: 'شريك ب' }], closedMonths: ['2026-07'], entries: [
    { id: 'me_1', description: 'تسوية سابقة', date: '2026-10-01', reason: 'فرق', byName: 'مدير', status: 'posted', entryNumber: 301, approvedByName: 'هادي',
      lines: [{ accountId: '5100', debit: 20, credit: 0 }, { accountId: '1010', debit: 0, credit: 20 }] }] } };
});
const accounts = [{ code: '1010', nameArabic: 'الصندوق' }, { code: '3200', nameArabic: 'تسويات فترة التأسيس' }, { code: '5100', nameArabic: 'تشغيل' },
  { code: '9000', nameArabic: 'موقوف', active: false }];
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const problems = () => screen.queryByRole('list', { name: 'ما يمنع الحفظ' })?.textContent || '';

describe('«قيد يدوي بموافقة» on the general ledger', () => {
  it('offers the chart and partner sub-accounts, and shows what blocks the entry before it can be saved', () => {
    render(<ManualJournalEntryCard accounts={accounts} />);
    const options = [...screen.getByLabelText('حساب السطر 1').options].map(o => o.value);
    expect(options).toEqual(['', '1010', '3000-p2', '3200', '5100']);
    fill('البيان', 'إعادة تصنيف'); fill('السبب', 'تصحيح تصنيف مصروف');
    fill('حساب السطر 1', '5100'); fill('مدين السطر 1', '100');
    fill('حساب السطر 2', '1010'); fill('دائن السطر 2', '90');
    expect(screen.getByText(/غير متوازن — الفرق/)).toBeTruthy();
    expect(problems()).toContain('القيد غير متوازن');
    expect(screen.getByRole('button', { name: 'حفظ القيد مقترحًا' })).toHaveProperty('disabled', true);
    fill('دائن السطر 2', '100');
    fill('التاريخ', '2026-07-10');
    expect(problems()).toContain('2026-07 مقفلة');
    fill('التاريخ', '2026-10-20');
    fill('حساب السطر 1', '3200');
    expect(screen.getByLabelText('سبب استخدام 3200')).toBeTruthy();
    expect(problems()).toContain('سبب استخدام 3200');
    fill('سبب استخدام 3200', 'فرق تنازل عنه هادي');
    expect(problems()).toBe('');
    expect(screen.getByRole('button', { name: 'حفظ القيد مقترحًا' })).toHaveProperty('disabled', false);
  });

  it('saves a balanced proposal after a confirmation, and lists entries with who created and who approved them', async () => {
    render(<ManualJournalEntryCard accounts={accounts} />);
    expect(screen.getByText(/أنشأه مدير · وافق عليه هادي/)).toBeTruthy();
    fill('التاريخ', '2026-10-20'); fill('البيان', 'إعادة تصنيف'); fill('السبب', 'تصحيح تصنيف مصروف');
    fill('حساب السطر 1', '5100'); fill('مدين السطر 1', '150'); fill('بيان السطر 1', 'مصروف');
    fill('حساب السطر 2', '3000-p2'); fill('دائن السطر 2', '150');
    fireEvent.click(screen.getByRole('button', { name: 'حفظ القيد مقترحًا' }));
    mock.api.mockResolvedValueOnce({ saved: true });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(mock.api).toHaveBeenCalled());
    expect(mock.api.mock.calls[0]).toEqual(['finance-workbench', { kind: 'founding', request: { action: 'proposeManualEntry', date: '2026-10-20',
      description: 'إعادة تصنيف', reason: 'تصحيح تصنيف مصروف', settlementReason: null, confirm: true,
      lines: [{ accountId: '5100', debit: 150, credit: 0, description: 'مصروف' }, { accountId: '3000-p2', debit: 0, credit: 150, description: '' }] } }]);
    await waitFor(() => expect(screen.getByText(/حُفظ القيد مقترحًا باسمك/)).toBeTruthy());
    expect(mock.read.refresh).toHaveBeenCalled();
  });

  it('is shown to the admin only', () => {
    mock.read = { ...mock.read, allowed: false };
    const { container } = render(<ManualJournalEntryCard accounts={accounts} />);
    expect(container.innerHTML).toBe('');
  });
});
