/**
 * The client's `validateEntry` is a PREVIEW; the server's is the authority.
 *
 * Two implementations of the same rules will drift unless something notices.
 * This drives both over the same battery and asserts they agree on the ONE
 * thing that matters — whether the entry may be posted — while allowing the
 * server to be stricter, which it is (it derives the period and rejects dates
 * that do not exist).
 */
import { describe, it, expect } from 'vitest';
import * as server from '../src/invariants.js';
import * as client from '../../src/lib/accounting/journal.js';

const line = (accountId, debit, credit) => ({ accountId, debit, credit });

const CASES = [
  ['balanced two-line', '2026-08-11', [line('1010', 115, 0), line('4000', 0, 115)]],
  ['balanced three-line', '2026-08-11', [line('1010', 115, 0), line('4000', 0, 100), line('2100', 0, 15)]],
  ['debit 100 credit 1', '2026-08-11', [line('1010', 100, 0), line('4000', 0, 1)]],
  ['one halala out', '2026-08-11', [line('1010', 100.01, 0), line('4000', 0, 100)]],
  ['single line', '2026-08-11', [line('1010', 100, 0)]],
  ['both sides on one line', '2026-08-11', [line('1010', 50, 50), line('4000', 0, 50), line('5100', 50, 0)]],
  ['negative amounts', '2026-08-11', [line('1010', -100, 0), line('4000', 0, -100)]],
  ['empty line', '2026-08-11', [line('1010', 0, 0), line('4000', 0, 0)]],
  ['missing account', '2026-08-11', [line('', 100, 0), line('4000', 0, 100)]],
  ['bad date', '11/08/2026', [line('1010', 100, 0), line('4000', 0, 100)]],
  ['rounding pair', '2026-08-11', [line('1010', 33.33, 0), line('4000', 0, 33.33)]],
];

describe('اتفاق العميل والخادم على ما يُقبل', () => {
  for (const [name, entryDate, lines] of CASES) {
    it(`«${name}» — نفس الحكم على الطرفين`, () => {
      const base = { entryDate, sourceType: 'manual', description: 'اختبار' };
      const s = server.validateEntry(
        { ...base, periodKey: server.periodKeyOf(entryDate) }, lines,
      );
      const c = client.validateEntry(
        { ...base, periodKey: client.periodKeyOf(entryDate) }, lines,
      );
      expect(s.length === 0).toBe(c.length === 0);
    });
  }

  it('مجاميع الطرفين متطابقة إلى الهللة', () => {
    for (const [, , lines] of CASES) {
      expect(server.totalsOf(lines)).toEqual(client.totalsOf(lines));
      expect(server.isBalanced(lines)).toBe(client.isBalanced(lines));
    }
  });

  it('التقريب متطابق على قيم حرجة', () => {
    for (const v of [0.005, 0.015, 1.005, 2.675, 1e-9, -0.005, 1234.565]) {
      expect(server.round2(v)).toBe(client.round2(v));
    }
  });

  // Where the server is deliberately STRICTER: a date that does not exist.
  // The client's preview lets it through, and the server refuses it — the
  // safe direction, and the reason the server has the last word.
  it('الخادم أشد في التواريخ غير الموجودة — والاتجاه صحيح', () => {
    const lines = [line('1010', 100, 0), line('4000', 0, 100)];
    const base = { sourceType: 'manual', description: 'اختبار', entryDate: '2026-02-30' };
    expect(server.validateEntry({ ...base, periodKey: '2026-02' }, lines))
      .toContain('تاريخ القيد غير موجود في التقويم.');
    expect(client.validateEntry({ ...base, periodKey: '2026-02' }, lines)).toEqual([]);
  });
});
