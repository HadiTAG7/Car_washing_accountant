import {it,expect} from 'vitest';
import {operationsHeading,operationsNotes,operationsSummary} from '../operationsReportPresentation';
import {operationsFixture} from '../../../server/__tests__/operationsFixture';
it('removes repeated leading report dates only in the display heading', () => {
  const report=operationsFixture({dateRiyadh:'2026-10-27',title:'27 أكتوبر: مراجعة 27 أكتوبر: غسلات أمس مطابقة للسجل'});
  expect(operationsHeading(report)).toBe('27 أكتوبر: غسلات أمس مطابقة للسجل');
  expect(report.title).toBe('27 أكتوبر: مراجعة 27 أكتوبر: غسلات أمس مطابقة للسجل');
  expect(operationsHeading({...report,title:'مراجعة 26 أكتوبر: غسلات أمس مطابقة للسجل'})).toContain('26 أكتوبر');
});
it('formats the owner view without changing source titles or narrative',()=>{
  const r=operationsFixture({title:'استكمال الغسلة5643311 — خدمة20 أكتوبر',summary:'تمت مراجعة3 حجوزات. البيانات جزئية؛يوجد عمل آخر.'}),before=JSON.stringify(r);
  const title=operationsHeading(r);expect(title).not.toContain('5643311');expect(title).toContain('استكمال الغسلة');expect(title).toContain('أكتوبر');
  expect(operationsSummary(r)).toHaveLength(2);expect(operationsSummary(r)[0]).toContain('3 حجوزات');expect(JSON.stringify(r)).toBe(before);
});
it('orders critical observations first and flags programming without rejecting or altering the note',()=>{
  const r=operationsFixture({visibleWarnings:[{id:'low',severity:'limitation',text:'تغطية محدودة'},{id:'code',severity:'open',text:'policyUnconfigured=true'},{id:'urgent',severity:'critical',text:'حادث يحتاج متابعة'}]});
  const notes=operationsNotes(r);expect(notes[0].id).toBe('urgent');expect(notes.find(n=>n.id==='code').needsWording).toBe(true);
  expect(r.visibleWarnings[1].text).toBe('policyUnconfigured=true');
});
it('keeps source identifiers in technical details rather than the owner summary',()=>{
  const report=operationsFixture({summary:'أُغلقت حالة5643311 بعد التحقق من الغسلة. الموضعssp__B-5643311 والعامل2007مثبتان؛Start21:18/End22:10منSSP.'});
  const summary=operationsSummary(report).join(' ');expect(summary).toContain('أُغلقت حالة بعد التحقق');expect(summary).not.toContain('5643311');expect(summary).not.toContain('ssp__B');expect(summary).not.toContain('Start');
  expect(report.summary).toContain('ssp__B-5643311');
});
it.each(['غسلة بايكر تجريبي 1234567 محفوظة بقرار المالك','إغلاق عائق تسجيل 1234567','متابعة الحجز١٢٣٤٥٦٧ بعد المراجعة'])('removes an opaque operational ID in any title position: %s',title=>{
  const report=operationsFixture({title});expect(operationsHeading(report)).not.toMatch(/[\d٠-٩]{7,}/u);expect(report.title).toBe(title);
});
it.each(['استُكملت الجاريتان 1234567 و1234568 بعد ظهور نهاية الخدمة. قراءة MCP المستقلة29/29 غسلة.','نتيجة SSP مؤكدة. قراءة ERP تحتاج مراجعة.','حُفظت الغسلتان 1234567 و1234568 ثم جرت قراءة PR87.'])('does not present internal references or worklog acronyms as an owner summary: %s',summary=>{
  const report=operationsFixture({summary}),visible=operationsSummary(report).join(' ');
  expect(visible).not.toMatch(/[\d٠-٩]{7,}|\b(?:MCP|SSP|ERP|PR\d+)\b/u);expect(report.summary).toBe(summary);
});
it('keeps browser and version diagnostics out of the summary and translates source status names',()=>{
  const report=operationsFixture({summary:'تغير Chrome داخل Codex v2. حالة 50Collecting Payment لا تثبت انتهاء الخدمة. رُفع التنبيه إلى CEO.'});
  const visible=operationsSummary(report).join(' ');expect(visible).not.toMatch(/Chrome|Codex|v2|Collecting|CEO/u);
  expect(visible).toContain('50 تحصيل الدفع');expect(visible).toContain('الرئيس التنفيذي');expect(report.summary).toContain('Codex');
});
