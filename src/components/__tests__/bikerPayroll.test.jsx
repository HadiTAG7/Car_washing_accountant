// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { downloadPayrollPdf } = vi.hoisted(() => ({
  downloadPayrollPdf: vi.fn(async () => 'مسير-رواتب-2026-08.pdf'),
}));
vi.mock('../../lib/payrollPdf', () => ({ downloadPayrollPdf }));

import BikerPayroll from '../BikerPayroll';
import {
  adjustmentsFromPayrollLines, payrollAdjustmentPayload, payrollAdvanceMax,
} from '../../lib/payrollUi';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('واجهة مسير رواتب البايكر', () => {
  it('تعرض السياسة والموعد الثابت والمعادلة وكل أعمدة التدقيق', () => {
    render(<BikerPayroll role="admin" previewMode />);

    const section = screen.getByRole('region', { name: 'مسير الرواتب' });
    expect(section.textContent).toContain('السياسة المعتمدة: أيام الشهر الفعلية');
    expect(section.textContent).toContain('عن الشهر السابق · بلا تحويل تلقائي');
    expect(section.textContent).toContain('صافي المستحق = الراتب المستحق + العمولة + البونص − الخصومات − السلفة المخصومة');
    expect(section.textContent).toContain('يُخصم كامل الرصيد القائم افتراضيًا، ويمكن تخفيضه قبل الاعتماد');
    expect(screen.getByText('تقديري قبل اكتمال الشهر')).toBeTruthy();

    for (const heading of [
      'العامل', 'الراتب / المباشرة', 'الأيام', 'الأساسي', 'العمولة',
      'البونص + السبب', 'الخصم + السبب', 'السلف القائمة', 'خصم السلفة', 'الصافي', 'الحالة',
    ]) expect(screen.getByRole('columnheader', { name: heading })).toBeTruthy();
  });

  it('تعرض ملخصات المسير وبطاقات الجوال لجميع البايكرز', () => {
    const { container } = render(<BikerPayroll role="admin" previewMode />);

    for (const label of ['إجمالي الأساسي', 'العمولات', 'البونص', 'الخصومات', 'السلف المخصومة', 'صافي الرواتب']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    expect(container.querySelectorAll('article')).toHaveLength(3);
    expect(screen.getAllByText('أحمد محمد').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/16\/31 يوماً/).length).toBeGreaterThanOrEqual(1);
  });

  it('ينشئ PDF من ورقة الطباعة ولا يعتمد على window.print', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<BikerPayroll role="admin" previewMode />);
    fireEvent.click(screen.getByRole('button', { name: /طباعة PDF/ }));
    await waitFor(() => expect(downloadPayrollPdf).toHaveBeenCalledWith(
      expect.any(HTMLElement), { periodKey: '2026-08' },
    ));
    expect(print).not.toHaveBeenCalled();
    expect(await screen.findByText('تم تجهيز ملف PDF للطباعة')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /صرف نقدي\/بنكي/ })).toBeNull();
  });

  it('يميز الافتراضي عن الصفر اليدوي في حمولة المعاينة ويعيد حساب الحد', () => {
    const defaulted = adjustmentsFromPayrollLines([{
      bikerId: 'b1', advanceDeduction: 200, advanceDeductionMode: 'default_full',
    }]);
    expect(payrollAdjustmentPayload(defaulted)[0]).not.toHaveProperty('advanceDeduction');

    const manual = adjustmentsFromPayrollLines([{
      bikerId: 'b1', advanceDeduction: 0, advanceDeductionMode: 'manual',
    }]);
    expect(payrollAdjustmentPayload(manual)[0]).toMatchObject({ advanceDeduction: 0 });
    expect(payrollAdvanceMax(
      { basicDue: 300, commission: 0, advanceOutstanding: 400 },
      { bonus: 100, deduction: 50 },
    )).toBe(350);
  });
});
