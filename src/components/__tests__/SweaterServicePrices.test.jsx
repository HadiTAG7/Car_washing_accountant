// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SweaterServicePrices from '../SweaterServicePrices';
vi.mock('../../data/initialData', async (load) => ({ ...(await load()), todayISO: () => '2026-10-31' }));
afterEach(cleanup);

const prices = [
  { id: 'p1', serviceType: 'interior_exterior_wash', nameArabic: 'غسيل داخلي وخارجي', priceMode: 'exclusive', vatRate: 0.15, netRate: 20, vatAmount: 3, grossRate: 23,
    effectiveFrom: '2026-09-01', status: 'active', createdByName: 'هادي', createdAtIso: '2026-08-30T10:00:00Z' },
  { id: 'p2', serviceType: 'interior_exterior_wash', priceMode: 'inclusive', vatRate: 0.15, netRate: 21.74, vatAmount: 3.26, grossRate: 25,
    effectiveFrom: '2026-10-15', status: 'active' },
  { id: 'p3', serviceType: 'interior_exterior_wash', priceMode: 'inclusive', vatRate: 0.15, netRate: 26.09, vatAmount: 3.91, grossRate: 30,
    effectiveFrom: '2026-12-01', status: 'active' },
];
const serviceTypes = [{ serviceType: 'interior_exterior_wash', bookings: 852 }, { serviceType: 'غسيل', bookings: 12, firstDate: '2026-09-02', lastDate: '2026-09-20' },
  { serviceType: '', bookings: 70 }];
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('«أسعار الخدمات» on the Sweater integration page', () => {
  it('shows each dated price with what is effective today, and the services still without a price', () => {
    render(<SweaterServicePrices prices={prices} serviceTypes={serviceTypes} />);
    const items = within(screen.getByRole('list', { name: 'سجل الأسعار' })).getAllByRole('listitem').map(li => li.textContent);
    expect(items[0]).toMatch(/يبدأ لاحقًا.*30\.00.*2026-12-01/);
    expect(items[1]).toMatch(/سارٍ اليوم.*21\.74 \+ ضريبة 3\.26 = 25\.00.*2026-10-15.*شامل الضريبة/);
    expect(items[2]).toMatch(/غسيل داخلي وخارجي · سابق.*قبل الضريبة.*أدخله هادي في 2026-08-30/);
    const note = screen.getByRole('note', { name: 'خدمات بلا سعر' }).textContent;
    expect(note).toContain('«غسيل» في 12 حجزًا بلا سعر (2026-09-02 إلى 2026-09-20)');
    expect(note).toContain('70 حجزًا بلا نوع خدمة');
    expect(screen.queryByRole('form', { name: 'إدخال سعر خدمة' })).toBeNull();
  });

  it('lets the admin enter service, price and whether tax is included, previews the split, and saves after a confirmation', async () => {
    const onSave = vi.fn().mockResolvedValue({ id: 'new' });
    render(<SweaterServicePrices prices={prices} serviceTypes={serviceTypes} canEdit onSave={onSave} />);
    fill('الخدمة', 'غسيل'); fill('السعر', '23');
    expect(screen.getByRole('list', { name: 'ما يمنع حفظ السعر' }).textContent).toContain('شامل الضريبة أو قبلها');
    expect(screen.getByRole('button', { name: 'حفظ السعر' })).toHaveProperty('disabled', true);
    fill('السعر شامل الضريبة؟', 'inclusive');
    expect(screen.getByText(/يُحفظ: صافي 20\.00 \+ ضريبة 3\.00 = 23\.00 لكل خدمة، من/)).toBeTruthy();
    fill('السعر شامل الضريبة؟', 'exclusive');
    expect(screen.getByText(/يُحفظ: صافي 23\.00 \+ ضريبة 3\.45 = 26\.45/)).toBeTruthy();
    fill('يسري من', '2026-11-01');
    fireEvent.click(screen.getByRole('button', { name: 'حفظ السعر' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'تأكيد حفظ السعر' })).getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ serviceType: 'غسيل', nameArabic: null, price: 23, priceMode: 'exclusive', vatRate: 0.15, effectiveFrom: '2026-11-01' }));
    await waitFor(() => expect(screen.getByText('حُفظ سعر «غسيل» من 2026-11-01 باسمك.')).toBeTruthy());
  });

  it('shows the server’s refusal and keeps the entry', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('هذا السعر مسجّل أصلًا لـ«غسيل» من 2026-10-31.'));
    render(<SweaterServicePrices prices={[]} serviceTypes={[]} canEdit onSave={onSave} />);
    expect(screen.getByText('لا أسعار مسجّلة بعد.')).toBeTruthy();
    fill('الخدمة', 'غسيل'); fill('السعر', '0.55'); fill('السعر شامل الضريبة؟', 'inclusive'); fill('نسبة الضريبة %', '15');
    fireEvent.click(screen.getByRole('button', { name: 'حفظ السعر' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('مسجّل أصلًا'));
    expect(screen.getByLabelText('الخدمة').value).toBe('غسيل');
  });
});
