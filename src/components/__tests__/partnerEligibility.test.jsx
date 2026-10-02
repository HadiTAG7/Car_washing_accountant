// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const view = vi.hoisted(() => ({ isPartnerView: true, viewedPartner: { partnerName: 'هادي' }, isAdmin: false, actingAsPartnerId: null }));
vi.mock('../../lib/firebaseClient', () => ({ callPartnerEligibilityGet: api.get, callPartnerEligibilitySet: api.set, describeBackendError: e => e.message }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => view }));
import PartnerEligibilityModal from '../PartnerEligibilityModal';
import PartnerEligibilityNotice from '../PartnerEligibilityNotice';
import PartnerViewBanner from '../PartnerViewBanner';
const partner = { id: 'hadi', partnerName: 'هادي', workersCount: 10 };
const config = { partnerId: 'hadi', revision: 2, currentMonth: '2026-10', current: { originalWorkers: 10, eligibleWorkers: 10 }, changes: [] };
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('أهلية البايكرز — واجهة الأدمن والشريك', () => {
  it('الأدمن يحفظ العدد المؤهل منفصلاً عن رأس المال مع السبب والشهر ونسخة الإعداد', async () => {
    api.get.mockResolvedValue(config); api.set.mockResolvedValue({ revision: 3 });
    const saved = vi.fn();
    render(<PartnerEligibilityModal partner={partner} onClose={() => {}} onSaved={saved} />);
    const input = await screen.findByLabelText('عدد البايكرز المؤهلين');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('سبب التغيير — للأدمن فقط'), { target: { value: 'سفر' } });
    expect(screen.getByText('5 بايكر')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'حفظ أهلية التشغيل' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.set).toHaveBeenCalledWith({ partnerId: 'hadi', periodKey: '2026-10', eligibleWorkers: 5, reason: 'سفر', expectedRevision: 2 });
    expect(partner.workersCount).toBe(10);
  });
  it('بلا سبب أو بعدد أكبر من الأصل أو كسر لا يسمح زر الحفظ', async () => {
    api.get.mockResolvedValue(config);
    render(<PartnerEligibilityModal partner={partner} onClose={() => {}} />);
    const input = await screen.findByLabelText('عدد البايكرز المؤهلين');
    const save = screen.getByRole('button', { name: 'حفظ أهلية التشغيل' });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('سبب التغيير — للأدمن فقط'), { target: { value: 'سفر' } });
    for (const value of ['11', '-1', '5.5', '']) {
      fireEvent.change(input, { target: { value } });
      expect(save.disabled).toBe(true);
    }
    expect(api.set).not.toHaveBeenCalled();
  });
  it('الاستعادة تعيد العدد الكامل بعد الحفظ فقط ولا تنفذ فور ضغط الاختصار', async () => {
    api.get.mockResolvedValue({ ...config, current: { originalWorkers: 10, eligibleWorkers: 5 } });
    render(<PartnerEligibilityModal partner={partner} onClose={() => {}} />);
    const input = await screen.findByLabelText('عدد البايكرز المؤهلين');
    expect(input.value).toBe('5');
    fireEvent.click(screen.getByRole('button', { name: 'إعادة العدد الكامل' }));
    expect(input.value).toBe('10');
    expect(api.set).not.toHaveBeenCalled();
  });
  it('اختيار شهر مستقبلي يقرأ التغيير المسجل فيه ولا يلغي استعادة مجدولة بصمت', async () => {
    api.get.mockResolvedValue({ ...config, current: { originalWorkers: 10, eligibleWorkers: 5 }, changes: [{ periodKey: '2026-10', eligibleWorkers: 5, reason: 'سفر' }, { periodKey: '2026-12', eligibleWorkers: 10, reason: 'رجوع' }] });
    render(<PartnerEligibilityModal partner={partner} onClose={() => {}} />);
    const input = await screen.findByLabelText('عدد البايكرز المؤهلين');
    fireEvent.change(screen.getByLabelText('يسري من شهر'), { target: { value: '2026-12' } });
    expect(input.value).toBe('10');
  });
  it('فشل القراءة لا يفتح حفظاً افتراضياً وفشل الحفظ لا يعطي تأكيد نجاح', async () => {
    api.get.mockRejectedValue(new Error('غير مصرح'));
    render(<PartnerEligibilityModal partner={partner} onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'حفظ أهلية التشغيل' })).toBeNull();
    api.get.mockResolvedValue(config);
    fireEvent.click(screen.getByRole('button', { name: 'إعادة تحميل الإعدادات' }));
    await screen.findByLabelText('عدد البايكرز المؤهلين');
    api.set.mockRejectedValue(new Error('تغيّر الإعداد'));
    fireEvent.change(screen.getByLabelText('سبب التغيير — للأدمن فقط'), { target: { value: 'استعادة' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ أهلية التشغيل' }));
    expect((await screen.findByRole('alert')).textContent).toContain('تغيّر الإعداد');
  });
  it('الشريك الموقوف يشوف أعداده فقط بدون سبب الأدمن أو نسبة', () => {
    render(<PartnerEligibilityNotice periodKey="2026-10" eligibility={{ originalWorkers: 10, eligibleWorkers: 5, suspendedWorkers: 5, factor: 0.2, reason: 'PRIVATE' }} />);
    expect(screen.getByRole('region', { name: 'أهلية بايكرزك' }).textContent).toContain('المؤهل للتشغيل5');
    expect(screen.getByText('العدد الأصلي')).toBeTruthy();
    expect(screen.queryByText(/PRIVATE|20%/)).toBeNull();
  });
  it('شريك آخر بلا تعطيل لا يشوف أي تنبيه أو إشارة إلى تغيير شريك غيره', () => {
    const { container } = render(<PartnerEligibilityNotice periodKey="2026-10" eligibility={{ originalWorkers: 10, eligibleWorkers: 10, suspendedWorkers: 0, factor: 0.4 }} />);
    expect(container.textContent).toBe('');
  });
  it('الشريط يبين اسم الشريك فقط بلا النسبة الحالية', () => {
    render(<PartnerViewBanner />);
    expect(screen.getByRole('status').textContent).toContain('هادي');
    expect(screen.getByRole('status').textContent).not.toMatch(/%|النسبة/);
  });
});
