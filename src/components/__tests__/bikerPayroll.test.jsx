// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BikerPayroll from '../BikerPayroll';

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

  it('يستدعي الطباعة من الزر ولا يعرض أزرار الصرف في وضع المعاينة الآمن', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<BikerPayroll role="admin" previewMode />);
    fireEvent.click(screen.getByRole('button', { name: /طباعة/ }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /صرف نقدي\/بنكي/ })).toBeNull();
  });
});
