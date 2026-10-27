import { expect, it } from 'vitest';
import { stripReportDatePrefixes } from '../reportDisplayHeading.js';
it.each(['27 أكتوبر: مراجعة 27 أكتوبر: النتيجة واضحة','٢٧ أكتوبر ٢٠٢٦: ملخص 27 أكتوبر: النتيجة واضحة','2026-10-27 — تقرير 27 أكتوبر: النتيجة واضحة'])('strips matching nested date prefixes: %s',title=>{
  expect(stripReportDatePrefixes(title,'2026-10-27')).toBe('النتيجة واضحة');
});
it('retains dates within a sentence and a different leading reporting date',()=>{
  expect(stripReportDatePrefixes('مراجعة 26 أكتوبر: المقارنة مع 27 أكتوبر','2026-10-27')).toBe('مراجعة 26 أكتوبر: المقارنة مع 27 أكتوبر');
  expect(stripReportDatePrefixes('النتيجة في 27 أكتوبر مستقرة','2026-10-27')).toBe('النتيجة في 27 أكتوبر مستقرة');
});
it.each(['مراجعة 26 أكتوبر 09:00','26 أكتوبر: مراجعة 26 أكتوبر 09:00','٢٦ أكتوبر: مراجعة ٢٦ أكتوبر ٠٩:٠٠','مراجعة 2026-10-26 09:00'])('removes the repeated date before a clock without losing the clock: %s', title=>{
  expect(stripReportDatePrefixes(title,'2026-10-26')).toBe('09:00');
});
it('keeps a different dated review with its clock',()=>{
  expect(stripReportDatePrefixes('مراجعة 25 أكتوبر 09:00','2026-10-26')).toBe('مراجعة 25 أكتوبر 09:00');
});
