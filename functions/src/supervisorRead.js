import { SUPERVISOR_COLLECTIONS, projectSupervisorRecord } from '../../src/lib/supervisorAccess.js';
import { supervisorReport } from '../../src/lib/supervisorReport.js';
import { LedgerError } from './ledger.js';
import { currentEligibilityMonth } from './partnerWorkerEligibility.js';

function readError(message) { return new LedgerError(message, { code: 'invalid-argument' }); }
const REPORT_COLLECTIONS = ['chart_of_accounts', 'journal_entries', 'journal_lines', 'accounting_periods', 'fee_rules', 'bikers', 'washes'];
export async function supervisorOverview(db, { periodKey } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodKey || '')) || periodKey > currentEligibilityMonth()) throw readError('اختر شهراً صحيحاً حتى الشهر الحالي.');
  const snapshots = await Promise.all(REPORT_COLLECTIONS.map(name => db.collection(name).select(...SUPERVISOR_COLLECTIONS[name].fields).get()));
  const data = Object.fromEntries(REPORT_COLLECTIONS.map((name, i) => [name, snapshots[i].docs.map(d => projectSupervisorRecord(name, d.data(), d.id))]));
  return { ...supervisorReport(data, periodKey), observedAt: new Date().toISOString(),
    sources: REPORT_COLLECTIONS.map((name, i) => ({ collection: name, count: snapshots[i].size, scope: 'all', complete: true })),
    periodsOutsideScope: 'لم تُفحص نتائج الفترات الأخرى.' };
}
export async function supervisorRecords(db, { collection, cursor = null, limit = 50 } = {}) {
  const spec = Object.hasOwn(SUPERVISOR_COLLECTIONS, collection || '') ? SUPERVISOR_COLLECTIONS[collection] : null;
  if (!spec) throw readError('مجموعة العمل المطلوبة غير مسموح بها.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw readError('حد الصفحة من 1 إلى 100.');
  if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.includes('/') || cursor.length > 1500)) throw readError('مؤشر الصفحة غير صالح.');
  let query = db.collection(collection).select(...spec.fields).orderBy('__name__').limit(limit + 1);
  if (cursor) query = query.startAfter(cursor);
  const snap = await query.get();
  const hasMore = snap.docs.length > limit;
  const rows = snap.docs.slice(0, limit).map(d => projectSupervisorRecord(collection, d.data(), d.id));
  return { collection, rows, limit, cursor, nextCursor: hasMore ? rows.at(-1).id : null,
    hasMore, scope: 'all-dates', fields: spec.fields, observedAt: new Date().toISOString() };
}
