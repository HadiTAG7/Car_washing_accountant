// Produces an administrative activation snapshot to stdout for review.
// No network, no database writes, no automatic publication or money totals.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseFinanceReport, financeReportId } from '../src/lib/financeReportContract.js';
export function carryOpenFinanceCases(followup, { cutAtRiyadh, sourceRef }) {
  const dateRiyadh = cutAtRiyadh.slice(0, 10), cases = new Map();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(followup.date) || !followup.cutUTC || followup.date >= dateRiyadh) throw new Error('A dated, older follow-up snapshot is required.');
  for (const old of [...(followup.issues || []), ...(followup.targetedCases || []), ...(followup.newCases || []), ...(followup.currentCases || [])]) {
    const caseId = old.caseId || old.id;
    if (!caseId || /^closed_/.test(old.status || '')) continue;
    const current = cases.get(caseId);
    const evidence = `حالة موروثة من سجل ${followup.date} وليست فحصًا حاليًا. الحالة الأصلية: ${old.status || 'غير محددة'}. المالك في السجل الأصلي: ${old.currentOwnerAfterMerge || old.currentFinancialOwnerAfterMerge || old.owner || 'غير محدد'}. ${old.evidence || old.remaining || ''}`;
    const verified = old.lastVerifiedAt || old.lastVerifiedAtUTC || old.lastVerifiedUTC;
    cases.set(caseId, { caseId, title: old.title || `متابعة مالية موروثة — ${caseId}`, ownerRole: 1, status: 'open',
      evidence: evidence.slice(0, 1800), next: String(old.next || old.remaining || 'إعادة التحقق ضمن الجولة التالية مع المختص وفق التفويض، دون اعتبار نقل الحالة حلًا.').slice(0, 1800),
      ...(verified ? { lastVerifiedAt: verified } : current?.lastVerifiedAt ? { lastVerifiedAt: current.lastVerifiedAt } : {}) });
  }
  const report = { schemaVersion: 1, dateRiyadh, cutAtRiyadh, sourceRole: 1, revision: 1,
    period: { kind: 'ad-hoc', from: dateRiyadh, to: dateRiyadh },
    title: 'افتتاح أرشيف المالية — الحالات الموروثة',
    summary: `نقل الحالات المالية المفتوحة بمعرفاتها من سجل ${followup.date} إلى مركز المالية. هذه مراجعة لنقل المتابعة، وليست جولة مالية جديدة أو تحققًا من أرصدة اليوم.`,
    review: { completed: true, reviewerRole: 1, at: cutAtRiyadh, sourceRef: `CFO-FINANCE-ACTIVATION-${dateRiyadh}` },
    metrics: [], visibleWarnings: [
      { id: 'inherited-not-current', severity: 'limitation', text: `كل المعلومات والمبالغ الواردة في أدلة الحالات موروثة كما في ${followup.date} وأقدم؛ لا تمثل أرصدة أو تحصيلًا أو اعتمادًا حاليًا. لا يعاد ترحيل أو دفع أي شيء بسبب نقل المتابعة.` },
      { id: 'not-new-verification', severity: 'open', text: 'تبقى الحالات مفتوحة إلى أن يتحقق حلها بدليل. لم يُختلق وقت تحقق للحالات التي لا يحمله سجلها، ومسؤول المتابعة المالية1 لا يستبدل صاحب المعالجة الأصلي.' } ],
    sources: [{ id: 'prior-cfo-followup', label: `سجل متابعة المدير المالي المحفوظ ${followup.date}`, sourceRef,
      checkedAt: followup.cutUTC, status: 'partial', coverage: 'حالات المتابعة المفتوحة فقط. تفاصيل السجل والأدلة الأصلية محفوظة؛ ليس كشف بنك أو فحص دفاتر بتاريخ التفعيل.' }],
    cases: [...cases.values()], sections: [],
    historicalIntegrity: 'يبدأ هذا الأرشيف من التفعيل. هذا إصدار إداري جديد لنقل المتابعة، ولا يُنسب نشرٌ قديم للموقع أو تتحول الأرصدة التاريخية إلى أرقام حية. تبقى مستندات Drive وسجلات التدقيق الأصلية محفوظة.' };
  return parseFinanceReport({ ...report, reportId: financeReportId(report) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, cutAtRiyadh] = process.argv.slice(2);
  if (!file || !cutAtRiyadh) throw new Error('Usage: node scripts/finance-carry-open-cases.mjs <follow-up.json> <activation-cut+03:00>');
  const raw = await readFile(file, 'utf8'), followup = JSON.parse(raw);
  const sourceRef = `CFO-FOLLOWUP-${followup.date}-${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;
  process.stdout.write(JSON.stringify(carryOpenFinanceCases(followup, { cutAtRiyadh, sourceRef }), null, 2));
}
