import {it,expect} from 'vitest';
import {operationsHeading,operationsNotes,operationsSummary} from '../operationsReportPresentation';
import {operationsFixture} from '../../../server/__tests__/operationsFixture';
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
