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
  it.each([0.2, 0.35])('لا تعرض نسبة الشريك حتى لو كانت موجودة في التقرير (%s)', factor => {
    const report = { ...journeyReport, factor };
    const before = JSON.stringify(report);
    const { container } = render(<CapitalJourneyContent report={report} />);
    expect(screen.getByText(/الأرقام أدناه تخص حصتك فقط\./)).toBeTruthy();
    expect(container.textContent).not.toMatch(/[%٪]/);
    expect(screen.getByText('المتبقي حسب التقرير').parentElement.textContent).toContain('8,800.00');
    expect(JSON.stringify(report)).toBe(before);
  });
  it('توضح تاريخ التمويل منفصلاً عن نطاق المصاريف والسند المتأخر يبقى بتاريخ دفعه', () => {
    render(<CapitalJourneyContent report={{ ...journeyReport, through: '2026-06-30',
      capitalJourney: { ...journeyReport.capitalJourney, fundingAsOf: '2026-10-03',
        receipts: [{ id: 'late', date: '2026-07-16', amount: 20000 }] } }} />);
    expect(screen.getByText(/تشمل الدفعات المتأخرة دون تغيير تواريخ سنداتها/)).toBeTruthy();
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
    expect(screen.getByText('رأس المال الذي دفعته').parentElement.textContent).toContain('20,000.00');
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
    expect(screen.getByText('تعذّر تحميل رحلة رأس مالك')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /إعادة المحاولة/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('المتبقي حسب التقرير')).toBeNull();
  });
  it('لا يعرض أصفاراً أو رصيداً أثناء تحميل التقرير', () => {
    query.mockReturnValue({ report: null, loading: true, error: null });
    render(<Page partner={{ id: 'p1' }} meta={{ title: 'رحلة رأس مالي' }} />);
    expect(screen.getByText('جارٍ تحميل رحلة رأس مالك...')).toBeTruthy();
    expect(screen.queryByText('رأس المال الذي دفعته')).toBeNull();
  });
});
