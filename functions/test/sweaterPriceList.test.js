import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/handlers.js';
import { resolveServicePrice } from '../src/sweater/pricing.js';
import { servicePriceRow } from '../src/sweater/priceRow.js';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';

const FieldValue = { serverTimestamp: () => 'SERVER_TIME' };
const admin = { uid: 'admin' }, accountant = { uid: 'acc' };
const seed = () => ({
  'users/admin': { role: 'admin', displayName: 'هادي' },
  'users/acc': { role: 'accountant', displayName: 'محاسب' },
  'sweater_bookings/b1': { periodKey: '2026-10', serviceDate: '2026-10-02', record: { serviceType: 'interior_exterior_wash' } },
  'sweater_bookings/b2': { periodKey: '2026-10', serviceDate: '2026-10-05', record: { serviceType: 'interior_exterior_wash' } },
  'sweater_bookings/b3': { periodKey: '2026-09', serviceDate: '2026-09-28', record: { serviceType: '' } },
});
const price = (overrides = {}) => ({ serviceType: 'interior_exterior_wash', price: 23, priceMode: 'inclusive', vatRate: 0.15, effectiveFrom: '2026-10-01', ...overrides });
const save = (db, data, who = admin) => dispatch(db, FieldValue, 'sweaterSaveServicePrice', data, who);
const prices = db => [...db.rows].filter(([k]) => k.startsWith('sweater_price_list/')).map(([k, v]) => ({ id: k.split('/')[1], ...v }));

describe('«أسعار الخدمات» — a dated price row per entry', () => {
  it('saves a tax-inclusive price in the admin’s name, and the settlement reads it from its effective date', async () => {
    const db = memoryFinanceDb(seed());
    const saved = await save(db, price());
    expect(saved).toMatchObject({ serviceType: 'interior_exterior_wash', priceMode: 'inclusive', vatRate: 0.15, netRate: 20, vatAmount: 3, grossRate: 23,
      effectiveFrom: '2026-10-01', effectiveTo: null, status: 'active', createdBy: 'admin', createdByName: 'هادي' });
    expect(prices(db)).toHaveLength(1);
    expect([...db.rows.values()].find(r => r.action === 'sweater-price-saved')).toMatchObject({ collectionName: 'sweater_price_list', userId: 'admin' });
    expect(resolveServicePrice(prices(db), 'interior_exterior_wash', '2026-10-15').snapshot).toMatchObject({ netRate: 20, vatAmount: 3, grossRate: 23 });
    expect(resolveServicePrice(prices(db), 'interior_exterior_wash', '2026-09-30')).toMatchObject({ known: false, reason: 'before-baseline' });
  });

  it('adds a later price without touching the earlier one, and refuses the exact same row twice', async () => {
    const db = memoryFinanceDb(seed());
    await save(db, price({ price: 20, priceMode: 'exclusive' }));
    await save(db, price({ price: 25, effectiveFrom: '2026-11-01' }));
    const rows = prices(db);
    expect(rows.map(r => [r.effectiveFrom, r.priceMode, r.netRate, r.grossRate])).toEqual([['2026-10-01', 'exclusive', 20, 23], ['2026-11-01', 'inclusive', 21.74, 25]]);
    expect(resolveServicePrice(rows, 'interior_exterior_wash', '2026-10-31').snapshot.grossRate).toBe(23);
    expect(resolveServicePrice(rows, 'interior_exterior_wash', '2026-11-02').snapshot.grossRate).toBe(25);
    await expect(save(db, price({ price: 25, effectiveFrom: '2026-11-01' }))).rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringContaining('مسجّل أصلًا') });
    expect(prices(db)).toHaveLength(2);
  });

  it('refuses a non-admin and every incomplete entry with its reason, writing nothing', async () => {
    const db = memoryFinanceDb(seed());
    await expect(save(db, price(), accountant)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(save(db, price({ priceMode: undefined }))).rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringContaining('شامل الضريبة') });
    await expect(save(db, price({ price: 0 }))).rejects.toMatchObject({ message: expect.stringContaining('السعر موجب') });
    await expect(save(db, price({ vatRate: 1.5 }))).rejects.toMatchObject({ message: expect.stringContaining('نسبة الضريبة') });
    await expect(save(db, price({ effectiveFrom: '' }))).rejects.toMatchObject({ message: expect.stringContaining('تاريخ بدء السريان') });
    await expect(save(db, price({ serviceType: '' }))).rejects.toMatchObject({ message: expect.stringContaining('الخدمة مطلوبة') });
    expect(prices(db)).toEqual([]);
  });

  it('accepts any halala amount and rate (0.07 × 100 is not exactly 7 in floating point)', () => {
    for (const amount of [0.07, 0.55, 23.45, 1150.29]) expect(servicePriceRow(price({ price: amount })).problems).toEqual([]);
    expect(servicePriceRow(price({ vatRate: 0.0029 })).problems).toEqual([]);
    expect(servicePriceRow(price({ price: 0.075 })).problems).toEqual(['السعر موجب بالهللة.']);
  });

  it('lists the services the bookings carry, with counts and dates, for the accountant', async () => {
    const db = memoryFinanceDb(seed());
    expect(await dispatch(db, FieldValue, 'sweaterServiceTypes', {}, accountant)).toEqual([
      { serviceType: 'interior_exterior_wash', bookings: 2, firstDate: '2026-10-02', lastDate: '2026-10-05' },
      { serviceType: '', bookings: 1, firstDate: '2026-09-28', lastDate: '2026-09-28' },
    ]);
  });
});
