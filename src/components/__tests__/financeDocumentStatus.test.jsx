// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import FinanceDocumentStatus from '../FinanceDocumentStatus';
import { financeWorkflowDimensions } from '../../lib/financeWorkflowDimensions';
afterEach(cleanup);

it('shows registration, saved pending review and blockers independently without inventing a tax number or authorizing an action', () => {
  const dimensions = financeWorkflowDimensions({ row: { finance_revision: 3, invoice_number: null, is_tax_invoice: true, vat_deductible: false,
    payment_status: 'paid', finance_metadata: { taxReviewRef: 'TEST-OPINION' } }, review: { status: 'pending', sourceHash: 'same' }, sourceHash: 'same',
    approved: false, postingReady: false, workflowStage: 'incomplete', issues: ['الحساب المقابل لهذا التمويل غير محسوم؛ لا يفترض الصندوق أو البنك.', 'حقول الفاتورة الضريبية غير مكتملة.'] }, { recorded: true });
  render(<FinanceDocumentStatus dimensions={dimensions} />);
  const states = within(screen.getByLabelText('حالات المصروف المنفصلة'));
  for (const text of ['مسجل بالفعل', 'تفاصيل محفوظة', 'مراجعة محفوظة — معلّقة', 'غير معتمد', 'غير مرحل', 'مسجل مدفوع — تحقق المسار غير مكتمل']) expect(states.getByText(text)).toBeTruthy();
  expect(screen.getByText('نواقص بيانات المصدر (0)')).toBeTruthy(); expect(screen.getByText('موانع الاعتماد والترحيل (2)')).toBeTruthy();
  expect(screen.getByText('رقم الفاتورة: غير مسجل في المصدر')).toBeTruthy(); expect(screen.getByText(/قابلة لخصم المدخلات: لا/)).toBeTruthy();
  expect(screen.queryAllByRole('button')).toHaveLength(0); expect(screen.queryAllByRole('textbox')).toHaveLength(0);
});
