import { parseOperationsReport } from './operationsReportContract.js';

// A booking follow-up, sync or assets-only report cannot certify broad coverage.
export function isOperationsReview(report, today) {
  return report?.sourceRole === 4 && report.archiveMode === 'current'
    && ['morning_review', 'weekly'].includes(report.kind)
    && report.dateRiyadh <= today && Number.isFinite(Date.parse(report.cutAtRiyadh));
}

export async function readLatestOperationsReview(request, today, signal) {
  let before, candidate;
  const cursors = new Set();
  do {
    const page = await request({ action: 'list', ...(before ? { before } : {}) }, signal);
    if (!Array.isArray(page?.items)) throw new Error('تعذر التحقق من أرشيف مراجعات التشغيل.');
    for (const item of page.items) {
      if (isOperationsReview(item, today) && (!candidate || Date.parse(item.cutAtRiyadh) > Date.parse(candidate.cutAtRiyadh))) candidate = item;
    }
    // IDs sort by date, then kind: read through the selected day before choosing.
    if (!page.nextBefore || (candidate && page.items.at(-1)?.dateRiyadh < candidate.dateRiyadh)) break;
    if (cursors.has(page.nextBefore)) throw new Error('تعذر التحقق من أرشيف مراجعات التشغيل.');
    cursors.add(page.nextBefore); before = page.nextBefore;
  } while (!signal?.aborted);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!candidate) return null;
  const data = await request({ action: 'read', reportId: candidate.reportId, revision: candidate.revision }, signal);
  const report = parseOperationsReport(data?.report);
  if (report.reportId !== candidate.reportId || report.revision !== candidate.revision || !isOperationsReview(report, today)) {
    throw new Error('تعذر التحقق من أرشيف مراجعات التشغيل.');
  }
  return report;
}

export function newerOperationsReview(operations, executive) {
  return Boolean(operations?.report && !operations.loading && !operations.error
    && (!executive || Date.parse(operations.report.cutAtRiyadh) > Date.parse(executive.cutAtRiyadh)));
}
