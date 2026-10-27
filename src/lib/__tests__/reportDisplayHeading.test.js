import { expect, it } from 'vitest';
import { stripReportDatePrefixes } from '../reportDisplayHeading.js';
it.each(['27 أكتوبر: مراجعة 27 أكتوبر: النتيجة واضحة','٢٧ أكتوبر ٢٠٢٦: ملخص 27 أكتوبر: النتيجة واضحة','2026-10-27 — تقرير 27 أكتوبر: النتيجة واضحة'])('strips matching nested date prefixes: %s',title=>{
  expect(stripReportDatePrefixes(title,'2026-10-27')).toBe('النتيجة واضحة');
});
it('retains dates within a sentence and a different leading reporting date',()=>{
  expect(stripReportDatePrefixes('مراجعة 26 أكتوبر: المقارنة مع 27 أكتوبر','2026-10-27')).toBe('مراجعة 26 أكتوبر: المقارنة مع 27 أكتوبر');
  expect(stripReportDatePrefixes('النتيجة في 27 أكتوبر مستقرة','2026-10-27')).toBe('النتيجة في 27 أكتوبر مستقرة');
});
