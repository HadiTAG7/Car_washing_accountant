import { expect, it } from 'vitest';
import { stripReportDatePrefixes, withReportDate } from '../reportDisplayHeading.js';
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
it.each(['لقطة 26 أكتوبر 22:00','فحص المصروفات — 26 أكتوبر 2026','لقطة 2026-10-26 22:00','النتيجة في ٢٦ أكتوبر مستقرة'])('does not add a report date already contained in meaningful text: %s', title=>{
  expect(withReportDate(title,'2026-10-26')).toBe(title);
});
it('adds the report date for a different day, without matching a day number suffix',()=>{
  expect(withReportDate('مقارنة 25 أكتوبر','2026-10-26')).toBe('26 أكتوبر: مقارنة 25 أكتوبر');
  expect(withReportDate('لقطة 21 أكتوبر','2026-10-01')).toBe('1 أكتوبر: لقطة 21 أكتوبر');
});
