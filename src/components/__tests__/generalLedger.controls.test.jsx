// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => {
  const accounts = [{ code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit' }, { code: '1020', nameArabic: 'البنك', accountType: 'asset', normalBalance: 'debit' }];
  const entries = [
    { id: 'original', entryNumber: 1, entryDate: '2026-05-01', status: 'posted', sourceType: 'expense', sourceKind: 'variable', sourceId: 'doc', description: 'مصروف جوالات', createdBy: 'test-recorded-user', createdAt: '2026-05-01T10:00:00Z' },
    { id: 'adjustment', entryNumber: 2, entryDate: '2026-05-02', status: 'posted', sourceType: 'adjustment', reversalOf: 'original', reversalReason: 'تصحيح مثبت', description: 'تسوية مصروف' },
  ];
  const lines = [{ entryId: 'original', accountId: '1010', debit: 0, credit: 100, description: 'سداد' }, { entryId: 'original', accountId: '1020', debit: 100, credit: 0 }, { entryId: 'adjustment', accountId: '1010', debit: 20, credit: 0 }];
  return { accounts, entries, lines, accountIndex: new Map(accounts.map((a) => [a.code, a])), loading: false, refetch: vi.fn() };
});
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => fixture }));
vi.mock('../../hooks/useLedgerSourceDocuments', () => ({ useLedgerSourceDocuments: () => ({ documents: new Map([['variable_expenses/doc', { description: 'جوال جديد', supplier: 'المتجر', invoice_number: 'INV-1', invoice_url: 'https://example.com/receipt' }]]) }) }));
vi.mock('../TopBar', () => ({ default: () => null }));
import GeneralLedgerPage from '../GeneralLedgerPage';
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

it('opens the linked account in the exact requested period', () => {
  window.history.replaceState({}, '', '?page=ledger&account=1020&from=2026-05-01&to=2026-05-02');
  try {
    render(<GeneralLedgerPage />);
    expect(screen.getByLabelText('الحساب').value).toBe('1020');
    expect(screen.getByLabelText('من تاريخ').textContent).toContain('1 مايو 2026');
    expect(screen.getByLabelText('إلى تاريخ').textContent).toContain('2 مايو 2026');
  } finally { window.history.replaceState({}, '', '/'); }
});

it('shows abnormal balance, descriptive document context, filtered rows and unchanged whole-account footer', () => {
  const { container } = render(<GeneralLedgerPage />);
  expect(screen.getByText('رصيد غير طبيعي')).toBeTruthy();
  expect(screen.getAllByText('المورد: المتجر').length).toBe(2);
  fireEvent.change(screen.getByLabelText('بحث بالمبلغ أو المورد أو الوصف أو رقم المستند'), { target: { value: '100' } });
  expect(screen.getByRole('button', { name: 'فتح القيد 1' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'فتح القيد 2' })).toBeNull();
  expect(container.querySelector('tfoot').textContent).toMatch(/80/);
  fireEvent.change(screen.getByLabelText('نوع المصدر'), { target: { value: 'manual' } });
  expect(screen.getByText('لا توجد حركات تطابق البحث')).toBeTruthy();
});

it('opens all entry lines, creator/time, source invoice and original entry without any write controls', () => {
  render(<GeneralLedgerPage />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح القيد 2' }));
  let dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('تصحيح مثبت')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'فتح القيد الأصلي #1' }));
  dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('test-recorded-user')).toBeTruthy();
  expect(within(dialog).getByText('1 May 2026, 13:00')).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: 'فتح المستند' }).getAttribute('href')).toBe('https://example.com/receipt');
  expect(within(dialog).getAllByRole('row').length).toBe(3);
  expect(within(dialog).queryByRole('button', { name: /حفظ|ترحيل|اعتماد/ })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'إغلاق تفاصيل القيد' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
