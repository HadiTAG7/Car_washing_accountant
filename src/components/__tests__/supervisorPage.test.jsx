// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../../hooks/useSupervisor', () => ({ useSupervisorOverview: () => ({}), useSupervisorRecords: () => ({}) }));
import { SupervisorDashboard } from '../SupervisorPage';
import { SupervisorRecords } from '../SupervisorRecordsPage';
import { supervisorReport } from '../../lib/supervisorReport';
import { supervisorFixture } from '../../../functions/test/fixtures/supervisor';
afterEach(cleanup);
describe('supervisor read-only RTL interface', () => {
  it('shows owner-confirmed basis and unsynchronized source targets without mutation controls', () => {
    const r = supervisorReport(supervisorFixture(), '2026-08');
    render(<SupervisorDashboard report={r} periodKey="2026-08" onPeriodChange={() => {}} />);
    expect(document.querySelector('main').dir).toBe('rtl');
    expect(screen.getByText(/netProfitBeforeFees/)).toBeTruthy(); expect(screen.getByText(/netProfit\)/)).toBeTruthy();
    expect(screen.getByText(/الأساس مؤكد من المالك/)).toBeTruthy(); expect(screen.getByText(/نسبة التحقيق: غير متاحة/)).toBeTruthy();
    expect(screen.getByText(/90% أو أكثر لكل شهر/)).toBeTruthy(); expect(screen.getByText(/سقف 5000 ريال لكل شهر مستقل/)).toBeTruthy();
    expect(screen.getByText(/لا توجد مزامنة تلقائية/)).toBeTruthy(); expect(screen.getByText(/تواريخ أشهر المتابعة الثلاثة: غير محددة/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /مرجع أهداف المشرف/ }).href).toContain('gid=2100000004');
    expect(screen.queryByRole('button', { name: /حفظ|تعديل|حذف|صرف|اعتماد|إضافة/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/private-phone|private-id/);
  });
  it('allows changing the read period only', () => {
    const change = vi.fn(); render(<SupervisorDashboard report={null} periodKey="2026-08" onPeriodChange={change} />);
    fireEvent.change(screen.getByLabelText('شهر الأداء والحسبة'), { target: { value: '2026-07' } }); expect(change).toHaveBeenCalledWith('2026-07');
  });
  it('failed reads hide former figures and offer read retry', () => {
    render(<SupervisorDashboard report={supervisorReport(supervisorFixture(), '2026-08')} periodKey="2026-08" onPeriodChange={() => {}} error={new Error('no-access')} />);
    expect(screen.getByRole('alert')).toBeTruthy(); expect(screen.queryByText('عامل تجريبي')).toBeNull();
  });
  it('declares pagination, does not turn empty page into a money figure', () => {
    const next = vi.fn(); render(<SupervisorRecords collection="bikers" onCollectionChange={() => {}} data={{ rows: [], hasMore: true, nextCursor: 'a' }} onNext={next} />);
    expect(screen.getByText(/توجد صفحات غير مفحوصة/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' })); expect(next).toHaveBeenCalled();
    expect(screen.getByText(/لا يمثل ذلك قيمة مالية/)).toBeTruthy();
  });
  it('does not render NaN/Infinity as money or quantities', () => {
    const r = supervisorReport(supervisorFixture(), '2026-08');
    r.share.referenceAmount = Infinity; r.statement.netProfit = NaN; r.kpis.completedQuantity = Infinity;
    render(<SupervisorDashboard report={r} periodKey="2026-08" onPeriodChange={() => {}} />);
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|∞/);
    expect(screen.getAllByText(/غير متاح/).length).toBeGreaterThan(0);
  });
});
