// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SweaterWashWorkerSummary from '../SweaterWashWorkerSummary';
import { summarizeOwnerWashes } from '../../lib/sweater/washSummary';
import { LanguageContext } from '../../i18n/LanguageContext';
afterEach(cleanup);
const wash = (id, extra = {}) => ({ sspBookingId: id, bikerId: 'worker-1', bikerName: 'Worker 1',
  quantity: 1, price: 20, workerCommissionPerWash: 4.5, washDate: '2026-10-03',
  status: 'مكتملة', revenueOrigin: 'sweater', collectionStatus: 'confirmed_by_owner', ...extra });
it.each(['ar', 'en'])('sorts workers numerically by recorded Sweater ID, with missing IDs last, in %s', language => {
  const bikers = ['10', '2', '001986', '1982', ''].map((driverExternalId, i) => ({ id: `worker-${i}`, name: `Worker ${i}`, driverExternalId }));
  const rows = bikers.map((b, i) => wash(`S-${i}`, { bikerId: b.id, bikerName: b.name, quantity: i + 1 }));
  const original = structuredClone({ bikers, rows });
  const { container } = render(<LanguageContext.Provider value={{ language }}><SweaterWashWorkerSummary washes={rows} bikers={bikers} /></LanguageContext.Provider>);
  const summary = screen.getByRole('table', { name: 'ملخص غسلات سويتر حسب العامل' });
  const cells = [...summary.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.textContent));
  expect(cells.map(r => r[0])).toEqual(['2', '10', '1982', '001986', '—']);
  expect(cells.map(r => r[1])).toEqual(['Worker 1', 'Worker 0', 'Worker 3', 'Worker 2', 'Worker 4']);
  expect(cells.map(r => Number(r[2]))).toEqual([2, 1, 4, 3, 5]);
  expect([...container.querySelectorAll('span[translate="no"]')].map(e => e.textContent)).toEqual(['2', '10', '1982', '001986', '—']);
  const details = screen.getByRole('table', { name: 'تفاصيل غسلات سويتر' });
  expect([...details.querySelectorAll('tbody tr')].map(r => r.querySelector('td').textContent)).toEqual(['2', '10', '1982', '001986', '—']);
  expect({ bikers, rows }).toEqual(original);
});
it('shows the same unscaled Sweater ID separately in desktop, mobile and booking details', () => {
  const bikers = [{ id: 'worker-1', name: 'Worker 1', driverExternalId: '001986' }];
  const rows = [wash('S-1')];
  const original = structuredClone({ bikers, rows });
  render(<SweaterWashWorkerSummary washes={rows} bikers={bikers} scalingFactor={0.5} />);
  const summary = screen.getByRole('table', { name: 'ملخص غسلات سويتر حسب العامل' });
  expect([...summary.querySelectorAll('th')].slice(0,2).map(x=>x.textContent)).toEqual(['Sweater ID','العامل']);
  expect([...summary.querySelectorAll('tbody td')].slice(0,2).map(x=>x.textContent)).toEqual(['001986','Worker 1']);
  const details = screen.getByRole('table', { name: 'تفاصيل غسلات سويتر' });
  expect([...details.querySelectorAll('th')].slice(0,2).map(x=>x.textContent)).toEqual(['Sweater ID','العامل']);
  expect([...details.querySelectorAll('tbody td')].slice(0,2).map(x=>x.textContent)).toEqual(['001986','Worker 1']);
  const mobileId = screen.getAllByText('001986').find(e => e.tagName === 'SPAN');
  expect(mobileId.parentElement.nextElementSibling.textContent).toBe('Worker 1');
  expect(within(summary).getByText('001986').getAttribute('dir')).toBe('ltr');
  expect(screen.getAllByText('001986')).toHaveLength(3);
  expect({ bikers, rows }).toEqual(original);
  expect(summarizeOwnerWashes(rows)[0]).toMatchObject({ quantity: 1, totalAmount: 20, commission: 4.5 });
});
it('groups by worker and excludes duplicate SSP IDs, cancellations and unrelated washes', () => {
  const rows = [wash('S-1'), wash('S-2'), wash('S-1'), wash('cancelled', { status: 'قيد التنفيذ' }), wash('direct', { revenueOrigin: 'direct' })];
  const result = summarizeOwnerWashes(rows);
  expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ quantity: 2, totalAmount: 40, commission: 9 });
  render(<SweaterWashWorkerSummary washes={rows} />);
  expect(screen.getByRole('table', { name: 'ملخص غسلات سويتر حسب العامل' })).toBeTruthy();
  expect(screen.getByText('غسلات منفذة؛ استحقاق العمولة مستقل عن التحصيل')).toBeTruthy();
  expect(screen.getByText('S-1')).toBeTruthy(); expect(screen.queryByText('cancelled')).toBeNull();
});
it('shows an executed unpaid wash and commission without calling it collected', () => {
  const rows = [wash('S-unpaid', { collectionStatus: 'pending', ownerTaxSnapshot: {
    source: 'owner_statement', clarificationId: 'synthetic-price-approval', currency: 'SAR',
    priceMode: 'exclusive', quantity: 1, net: 20, vat: 3, gross: 23,
  } })];
  expect(summarizeOwnerWashes(rows)[0]).toMatchObject({ quantity: 1, totalAmount: 20, commission: 4.5 });
  render(<SweaterWashWorkerSummary washes={rows} />);
  expect(screen.getByText('S-unpaid')).toBeTruthy();
  expect(screen.queryByText(/محصلة بإفادة المالك/)).toBeNull();
  expect(screen.getByText('غسلات منفذة؛ استحقاق العمولة مستقل عن التحصيل')).toBeTruthy();
});
it('does not show an empty summary; current completed executions use the shared rate', () => {
  render(<SweaterWashWorkerSummary washes={[wash('direct', { revenueOrigin: 'direct' })]} />);
  expect(screen.queryByRole('table')).toBeNull();
  expect(summarizeOwnerWashes([wash('S-1', { workerCommissionPerWash: null })])[0].commission).toBe(4.5);
});
it('uses the current registered name in each language across mobile, summary and booking details without changing washes', () => {
  const bikers = [{ id: 'worker-1', name: 'اسم قديم', nameArabic: 'اسم عربي مسجل', nameEnglish: 'Registered English Name' }];
  const rows = [wash('S-1', { bikerName: 'اسم قديم' })];
  const original = structuredClone({ bikers, rows });
  const view = language => <LanguageContext.Provider value={{ language }}><SweaterWashWorkerSummary washes={rows} bikers={bikers} /></LanguageContext.Provider>;
  const { rerender } = render(view('en'));
  expect(screen.getAllByText('Registered English Name')).toHaveLength(3);
  expect(screen.queryByText('اسم قديم')).toBeNull(); expect(screen.queryByText('اسم عربي مسجل')).toBeNull();
  rerender(view('ar'));
  expect(screen.getAllByText('اسم عربي مسجل')).toHaveLength(3);
  expect(screen.queryByText('Registered English Name')).toBeNull();
  expect({ bikers, rows }).toEqual(original);
  expect(summarizeOwnerWashes(rows)[0]).toMatchObject({ quantity: 1, totalAmount: 20, commission: 4.5 });
});
it.each([
  ['en', { nameArabic: 'اسم عربي فقط', nameEnglish: '' }, 'اسم عربي فقط'],
  ['ar', { nameArabic: '', nameEnglish: 'English only' }, 'English only'],
  ['en', { name: 'اسم قديم فقط', nameArabic: '', nameEnglish: '' }, 'اسم قديم فقط'],
])('falls back to a recorded name in %s without inventing a translation', (language, names, expected) => {
  render(<LanguageContext.Provider value={{ language }}><SweaterWashWorkerSummary washes={[wash('S-1')]} bikers={[{ id: 'worker-1', ...names }]} /></LanguageContext.Provider>);
  expect(screen.getAllByText(expected)).toHaveLength(3);
});
it('keeps the wash snapshot when its registry record is missing and never matches a different id by name', () => {
  render(<LanguageContext.Provider value={{ language: 'en' }}><SweaterWashWorkerSummary washes={[wash('S-1')]}
    bikers={[{ id: 'different-worker', name: 'Worker 1', nameEnglish: 'Do not use this worker' }]} /></LanguageContext.Provider>);
  expect(screen.getAllByText('Worker 1')).toHaveLength(3);
  expect(screen.queryByText('Do not use this worker')).toBeNull();
});
