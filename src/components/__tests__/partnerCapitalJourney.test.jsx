// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { journeyReport } from './fixtures/capitalJourney';

const query = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/usePartnerStatement', () => ({ usePartnerStatement: query }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, missingEnvNames: [],
  describeBackendError: error => error.message, maskedProjectRef: () => '' }));
vi.mock('../TopBar', () => ({ default: ({ title }) => <h1>{title}</h1> }));
const { default: Page, CapitalJourneyContent } = await import('../PartnerCapitalJourneyPage');
afterEach(() => { cleanup(); query.mockReset(); });

describe('رحلة رأس مال الشريك', () => {
  it('يبقي مجموعة بصافي صفر ظاهرة ويعرض الحالة الفارغة فقط عندما لا توجد بنود', () => {
    const report = { ...journeyReport, capitalJourney: { ...journeyReport.capitalJourney,
      initialTotal: 0, initialItems: [
        { id: 'b', groupKey: 'startup:bike', kind: 'startup', description: 'الدباب', amount: 38.8 },
        { id: 'r', groupKey: 'startup:bike', kind: 'startup', description: 'الدباب', amount: -38.8, reversal: true },
      ],
    } };
    const { rerender } = render(<CapitalJourneyContent report={report} />);
    const table = screen.getByRole('table', { name: 'تفاصيل صرف التأسيس' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(table.querySelector('tbody').textContent).toContain('0.00');
    rerender(<CapitalJourneyContent report={{ ...report, capitalJourney: { ...report.capitalJourney, initialItems: [] } }} />);
    expect(screen.queryByRole('table', { name: 'تفاصيل صرف التأسيس' })).toBeNull();
    expect(screen.getByText('ما فيه مستندات صرف تأسيس ضمن هالنطاق')).toBeTruthy();
  });
  it('يعرض صفاً لكل بند مؤكد دون تاريخ منفرد لإجمالي عدة عمليات، ويُبقي العكس المجهول واضحاً', () => {
    const initialItems = [
      { id: 'f1', groupKey: 'startup:franchise', description: 'رسوم الفرنشايز', kind: 'startup', amount: 12000, date: '2026-09-01' },
      { id: 'f2', groupKey: 'startup:franchise', description: 'رسوم الفرنشايز', kind: 'startup', amount: 38000, date: '2026-09-02' },
      { id: 'b1', groupKey: 'startup:bike', description: 'الدباب', kind: 'startup', amount: 38800 },
      { id: 'b2', groupKey: 'startup:bike', description: 'الدباب', kind: 'startup', amount: 38799.97 },
      { id: 'b3', groupKey: 'startup:bike', description: 'الدباب', kind: 'startup', amount: -38800, reversal: true },
      { id: 'unknown', description: 'استرداد غير مربوط', kind: 'startup', amount: -1, reversal: true },
    ];
    render(<CapitalJourneyContent report={{ ...journeyReport, capitalJourney: {
      ...journeyReport.capitalJourney, initialItems, initialTotal: 88798.97,
    } }} />);
    const table = screen.getByRole('table', { name: 'تفاصيل صرف التأسيس' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(within(table).getAllByText('رسوم الفرنشايز')).toHaveLength(1);
    expect(within(table).getByText('رسوم الفرنشايز').closest('tr').textContent).toContain('50,000.00');
    expect(within(table).getByText('الدباب').closest('tr').textContent).toContain('38,799.97');
    expect(within(table).getByText(/عكس \/ استرداد — استرداد غير مربوط/)).toBeTruthy();
    expect(within(table).getByText('صافي بعد العكس / الاسترداد')).toBeTruthy();
    expect(within(table).queryByText('البند والتاريخ')).toBeNull();
    expect(within(table).getByText('البند')).toBeTruthy();
    expect(table.textContent).not.toContain('2026');
    expect(table.querySelector('tfoot').textContent).toContain('88,798.97');
  });
  it.each([0.2, 0.35])('لا تعرض نسبة الشريك حتى لو كانت موجودة في التقرير (%s)', factor => {
    const report = { ...journeyReport, factor };
    const before = JSON.stringify(report);
    const { container } = render(<CapitalJourneyContent report={report} />);
    expect(screen.getByText(/الأرقام اللي تحت تخص حصتك بس\./)).toBeTruthy();
    expect(container.textContent).not.toMatch(/[%٪]/);
    expect(screen.getByText('المتبقي حسب التقرير').parentElement.textContent).toContain('8,800.00');
    expect(JSON.stringify(report)).toBe(before);
  });
  it('توضح تاريخ التمويل منفصلاً عن نطاق المصاريف والسند المتأخر يبقى بتاريخ دفعه', () => {
    render(<CapitalJourneyContent report={{ ...journeyReport, through: '2026-06-30',
      capitalJourney: { ...journeyReport.capitalJourney, fundingAsOf: '2026-10-03',
        receipts: [{ id: 'late', date: '2026-07-16', amount: 20000 }] } }} />);
    expect(screen.getByText(/تشمل الدفعات المتأخرة من غير ما تتغيّر تواريخ سنداتها/)).toBeTruthy();
    expect(screen.getByText(/16 يوليو 2026/)).toBeTruthy();
  });
  it('تعرض الفرنشايز والدباب وسنداته وتفصل المصاريف عن المحجوز', () => {
    render(<CapitalJourneyContent report={journeyReport} />);
    const table = screen.getByRole('table', { name: 'تفاصيل صرف التأسيس' });
    expect(within(table).getByText('رسوم الفرنشايز')).toBeTruthy();
    expect(within(table).getByText('قيمة الدباب')).toBeTruthy();
    expect(within(table).getByText(/10,000.00/)).toBeTruthy();
    expect(screen.getByText('احتياطي التجديد المحجوز — لم يُصرف')).toBeTruthy();
    expect(screen.getByText('المتبقي حسب التقرير').parentElement.textContent).toContain('8,800.00');
    expect(screen.getByText('رأس المال اللي دفعته').parentElement.textContent).toContain('20,000.00');
    expect(screen.getByText(/رصيد تحليلي/)).toBeTruthy();
  });
  it('المجموعات مغلقة افتراضياً والضغط يفتح التفاصيل ويغلقها دون تغيير الإجمالي', () => {
    render(<CapitalJourneyContent report={journeyReport} />);
    const label = screen.getByText('المصاريف المتغيرة والعمولات');
    const summary = label.closest('summary');
    const group = summary.closest('details');
    expect(group.open).toBe(false);
    expect(summary.textContent).toContain('300.00');
    fireEvent.click(summary);
    expect(group.open).toBe(true);
    expect(within(group).getByText('بنزين التشغيل')).toBeTruthy();
    fireEvent.click(summary);
    expect(group.open).toBe(false);
    expect(summary.textContent).toContain('300.00');
  });
  it('لا تؤكد رصيداً نهائياً أو شهرياً عندما تكون مستندات المصدر ناقصة', () => {
    const report = { ...journeyReport, capitalJourney: { ...journeyReport.capitalJourney,
      complete: false, warnings: [{ description: 'الفرنشايز', amount: 200, reason: 'تفصيل الصرف ناقص' }] } };
    render(<CapitalJourneyContent report={report} />);
    expect(screen.getByRole('alert').textContent).toContain('الفرنشايز');
    expect(screen.getByText('غير مؤكد')).toBeTruthy();
    expect(screen.queryByText('المتبقي حسب التقرير')).toBeNull();
    expect(screen.queryByText(/رصيد التأسيس بنهاية الشهر/)).toBeNull();
  });
  it('تطلب تقرير الشريك المصرح به فقط ويتيح الخطأ إعادة المحاولة', () => {
    const refetch = vi.fn();
    query.mockReturnValue({ report: null, loading: false, error: new Error('source unavailable'), refetch });
    render(<Page partner={{ id: 'p1' }} meta={{ title: 'رحلة رأس مالي' }} />);
    expect(query).toHaveBeenCalledWith({ partnerId: 'p1', includeCapitalJourney: true });
    expect(screen.getByText('ما قدرنا نحمّل رحلة رأس مالك')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /إعادة المحاولة/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('المتبقي حسب التقرير')).toBeNull();
  });
  it('لا يعرض أصفاراً أو رصيداً أثناء تحميل التقرير', () => {
    query.mockReturnValue({ report: null, loading: true, error: null });
    render(<Page partner={{ id: 'p1' }} meta={{ title: 'رحلة رأس مالي' }} />);
    expect(screen.getByText('نحمّل رحلة رأس مالك...')).toBeTruthy();
    expect(screen.queryByText('رأس المال اللي دفعته')).toBeNull();
  });
});
