/* eslint-disable react-refresh/only-export-components -- isolated harness only */
import { useEffect, useState } from 'react';
import { operationsFixture } from '../../server/__tests__/operationsFixture.js';
import { parseOperationsReport } from '../../src/lib/operationsReportContract.js';
const original = operationsFixture();
const corrected = operationsFixture({ revision: 2, correctionReason: 'تصحيح اختباري لا يغير النسخة الأولى', summary: 'نسخة ثانية اصطناعية لا تمثل التشغيل الحقيقي.' });
const history = operationsFixture({ archiveMode: 'historical_imported', sourceRole: 7, sourceLabel: 'مزامنة العمليات — الدور الأصلي7', kind: 'sync', round: 'old-example',
  cutAtRiyadh: null, issuedAtRiyadh: null, serviceDateRiyadh: null, period: { from: null, to: null },
  historicalImported: { originalSourceRole: 7, originalSourceRef: 'OLD-SYNTHETIC', originalReportDate: '2026-10-18', sourceSha256: 'a'.repeat(64), evidenceThroughDate: '2026-10-18', cutPrecision: 'date_only', timeNote: 'تاريخ فقط؛ وقت القطع ونطاق الخدمة غير موثقين، لا نفترض00:00.' } });
const evening = operationsFixture({ round: '2200', snapshot: 'partial', kind: 'assets', title: 'لقطة مساء اصطناعية للأصول',
  cutAtRiyadh: '2026-10-18T22:00:00+03:00', issuedAtRiyadh: '2026-10-18T22:05:00+03:00', review: { ...original.review, at: '2026-10-18T22:05:00+03:00' } });
const store = new Map([[original.reportId, [original, corrected]], [history.reportId, [history]], [evening.reportId, [evening]]]);
const savedAt = '2026-10-19T07:00:00Z';
export async function callOperationsApi(endpoint, input) {
  if (endpoint !== 'operations-reports') throw new Error('Harness rejects all other endpoints.');
  if (input.action === 'list') return { items: [...store.values()].map(rows => rows.at(-1)), nextBefore: null };
  if (input.action === 'read') {
    const rows = store.get(input.reportId); if (!rows) return { report: null, history: [] };
    return { report: rows.find(r => r.revision === (input.revision || rows.at(-1).revision)) || null,
      currentRevision: rows.at(-1).revision, savedAt, history: [...rows].reverse().map(r => ({ revision: r.revision, reason: r.correctionReason || 'الإصدار الأول', savedAt })) };
  }
  if (input.action !== 'save') throw new Error('Harness rejects non-report operations.');
  const report = parseOperationsReport(input.report), rows = store.get(report.reportId) || [], previous = rows.find(r => r.revision === report.revision);
  if (previous && JSON.stringify(previous) !== JSON.stringify(report)) throw new Error('تعارض النسخة في الاختبار.');
  if (!previous) { if ((rows.at(-1)?.revision || 0) !== input.expectedRevision) throw new Error('نسخة قديمة.'); store.set(report.reportId, [...rows, report]); }
  return { reportId: report.reportId, revision: report.revision, duplicate: Boolean(previous) };
}
export function useOperationsRead(endpoint, request, enabled = true) {
  const [version, setVersion] = useState(0), [data, setData] = useState(null);
  const key = JSON.stringify(request), allowed = !new URLSearchParams(window.location.search).has('partner');
  useEffect(() => { let current = true; if (allowed && enabled) callOperationsApi(endpoint, JSON.parse(key)).then(value => { if (current) setData(value); });
    return () => { current = false; }; }, [key, endpoint, enabled, version, allowed]);
  return { data, allowed, loading: false, error: null, refresh: () => setVersion(v => v + 1) };
}
export default function PreviewTopBar({ title, subtitle }) { return <header style={{ padding: 20 }}><h1>{title}</h1><p>{subtitle}</p></header>; }
