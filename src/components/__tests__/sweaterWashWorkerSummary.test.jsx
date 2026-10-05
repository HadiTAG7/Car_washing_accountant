// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SweaterWashWorkerSummary from '../SweaterWashWorkerSummary';
import { summarizeOwnerWashes } from '../../lib/sweater/washSummary';
import { LanguageContext } from '../../i18n/LanguageContext';
afterEach(cleanup);
const wash = (id, extra = {}) => ({ sspBookingId: id, bikerId: 'worker-1', bikerName: 'Worker 1',
  quantity: 1, price: 20, workerCommissionPerWash: 4.5, washDate: '2026-10-03',
  status: 'مكتملة', revenueOrigin: 'sweater', collectionStatus: 'confirmed_by_owner', ...extra });
it('groups by worker and excludes duplicate SSP IDs, cancellations and unrelated washes', () => {
  const rows = [wash('S-1'), wash('S-2'), wash('S-1'), wash('cancelled', { status: 'قيد التنفيذ' }), wash('direct', { revenueOrigin: 'direct' })];
  const result = summarizeOwnerWashes(rows);
  expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ quantity: 2, totalAmount: 40, commission: 9 });
  render(<SweaterWashWorkerSummary washes={rows} />);
  expect(screen.getByRole('table', { name: 'ملخص غسلات سويتر حسب العامل' })).toBeTruthy();
  expect(screen.getByText('محصلة بإفادة المالك؛ العمولة تُدفع مع الراتب')).toBeTruthy();
  expect(screen.getByText('S-1')).toBeTruthy(); expect(screen.queryByText('cancelled')).toBeNull();
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
