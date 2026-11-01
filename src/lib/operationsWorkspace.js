import { monthRange } from './accounting/monthlyStatement.js';
import { bikerBreakEven, dailyBreakEven } from './breakEven.js';
import { overviewBusinessMetrics, overviewSweaterMetrics } from './overviewInsights.js';
import { operationsToday, activeOperationsBikers } from './operationsToday.js';
import { housingOverview } from './housingOverview.js';
import { fleetSummary, fleetInventorySummary, EXPECTED_FLEET_COUNT } from './fleet.js';
import { COMPENSATION_KEYS } from '../../functions/src/sweater/metricsContract.js';
import { objectionDeadline } from '../../functions/src/sweater/compensationEvents.js';
import { isInternalQualityObjection } from './sweater/qualityRecordTypes.js';
export const operationsReadinessText = value => value.ready?'جاهز لتسوية سويتر':`غير جاهز: ${value.failedCount} بنود`;

// Read-only composition of the existing page models. No alternate payroll,
// break-even, occupancy, source count, or objection-deadline calculation.
export function operationsWorkspace({ periodKey, today, ops = null, bikers = null, washes = [], bookings = null,
  statement = null, payrollLines = null, idle = null, snapshot = null, resources = null, freshness = null } = {}) {
  const range = monthRange(periodKey), ended = Boolean(range.to && range.to < today);
  if (idle?.error) idle=null;
  if (snapshot?.periodKey!==periodKey) snapshot=null;
  const href = page => `?page=${page}&period=${periodKey}`;
  const washKnown = Boolean(ops && !ops.conflicts?.length);
  const financeKnown = Boolean(statement && !statement.issues?.length);
  const per = financeKnown && payrollLines && bikers && washKnown
    ? bikerBreakEven({ periodKey, today, statement, payrollLines, bikers, washes }) : null;
  const daily = financeKnown ? dailyBreakEven({ statement, periodKey, completeMonth: ended }) : null;
  const business = washKnown ? overviewBusinessMetrics(ops, statement) : null;
  const metrics = overviewSweaterMetrics(snapshot, washKnown ? ops : null);
  const selectedDay = ended ? range.to : today;
  const timing = washKnown && bookings && bikers ? operationsToday({ day: selectedDay, today, washes, bikers, bookings, snapshot }).reconciliation : null;
  const readAt = snapshot?.metricSources?.completedWashes?.extractedAtIso;
  // A complete month can be compared with its own reading after month-end.
  // A running month requires the existing daily model's exact-time evidence.
  const finalReading = ended && snapshot?.periodKey === periodKey && readAt && Date.parse(readAt) >= Date.parse(`${range.to}T21:00:00Z`);
  const difference = washKnown && finalReading ? metrics?.washDifference ?? null : timing?.difference ?? null;
  const unlinked = washKnown && bikers ? ops.rows.filter(w => !w.bikerId || !bikers.some(b => String(b.id) === String(w.bikerId))).length : null;
  const roster = bikers ? activeOperationsBikers(bikers, selectedDay) : null;
  const missingLink = roster?.filter(b => !String(b.driverExternalId || '').trim()).length ?? null;
  const housing = resources && bikers ? housingOverview({ items: resources.startup, entries: resources.startupEntries,
    annualItems: resources.annual, annualEntries: resources.annualEntries, metaRows: resources.housing, bikers, today }) : null;
  const housingActive = housing?.rows.reduce((n,r) => n + r.active.length,0) ?? null;
  const housingInactive = housing?.rows.reduce((n,r) => n + r.inactive.length,0) ?? null;
  const vacancies = housing && housing.rows.length && housing.rows.every(r => r.vacant !== null) ? housing.rows.reduce((n,r) => n + r.vacant,0) : null;
  const fleet = resources ? fleetSummary({ bikes: resources.bikes, policies: resources.policies, maintenance: resources.maintenance, today }) : null;
  const inventory = resources ? fleetInventorySummary(resources) : null;
  const registered = inventory?.registered ?? null, missingBikes=inventory?.missing??null, workingBikes=inventory?.working??null;
  const repairBikes = registered ? inventory.maintenance : null;
  const incompleteDetails = COMPENSATION_KEYS.filter(key => !snapshot?.eventGroups?.[key]?.complete);
  const events = COMPENSATION_KEYS.flatMap(key => snapshot?.eventGroups?.[key]?.rows || []);
  const objections = (resources?.objections || []).filter(isInternalQualityObjection);
  const nearDeadline = resources?.qualitySettings?.deadlineDays != null ? events.filter(row => {
    const saved = objections.find(o => o.metricKey === row.metricKey && o.sourceId === row.sourceId && o.snapshotId === snapshot?.metricSources?.[row.metricKey]?.snapshotId);
    const due = objectionDeadline(row, resources.qualitySettings.deadlineDays, today, saved?.status);
    return due?.tone === 'red' || due?.tone === 'yellow';
  }).length : null;
  const checks = [
    ['ended','الشهر انتهى',ended,ended?0:1,href('operations_close'),range.to],
    ['count','عدد الغسلات يطابق سويتر',difference === 0,difference,href('washes'),difference===null?'لا توجد مطابقة مؤكدة لنفس وقت القراءة.':null],
    ['wash-link','ما فيه غسلات بدون بايكر',unlinked===0,unlinked,href('washes')],
    ['idle-reason','كل الخاملين لهم سبب',idle?.alerts.missingReason===0,idle?.alerts.missingReason??null,href('bikers')+'&bikerTab=idle'],
    ['sweater-link','كل البايكرية النشطين مربوطين بسويتر',missingLink===0,missingLink,href('bikers')],
    ['details','تفاصيل مخالفات وإلغاءات سويتر وصلت',incompleteDetails.length===0,incompleteDetails.length,href('quality_violations')],
    ['housing','السكن محدّث',housingInactive===0&&Boolean(housing?.rows.length),housingInactive,href('housing')],
    ['fleet','الأسطول محدّث',registered>=EXPECTED_FLEET_COUNT&&missingBikes===0&&!fleet?.longMaintenance.length&&resources.bikes.every(b=>b.internalNumber&&b.status),missingBikes,href('fleet'), 'مطابقة سجل الدبابات الخمسين ومتابعة الصيانة المتأخرة.'],
  ].map(([id,label,ok,count,url,note])=>({id,label,ok:Boolean(ok),count,href:url,note}));
  const actions = [
    ['idle','خاملين بدون سبب',idle?.alerts.missingReason,href('bikers')+'&bikerTab=idle'],
    ['link','بايكرية غير مربوطين بسويتر',missingLink,href('bikers')],
    ['housing','ساكنين يحتاجون إخلاء',housingInactive,href('housing')],
    ['fleet','دبابات ما انسجلت',missingBikes,href('fleet')],
    ['objection','مخالفات قربت مهلة اعتراضها أو انتهت',nearDeadline,href('quality_violations')],
    ['freshness','بيانات سويتر متأخرة',freshness?.tone==='green'?0:1,href('sweater_integration')],
    ['count','فرق عدد يحتاج مطابقة',metrics?.washDifference == null?null:Math.abs(metrics.washDifference),href('operations_close')],
  ].filter(([, ,count])=>count>0).map(([id,label,count,url])=>({id,label,count,href:url}));
  return { periodKey, today, ended, checks, failedCount:checks.filter(c=>!c.ok).length, ready:checks.every(c=>c.ok), actions,
    quantity:washKnown?ops.quantity:null,sweater:metrics?.completedWashes??null,sweaterReadAt:readAt||null,difference,
    dailyActual:business?.currentDailyRate??null,dailyRequired:daily?.required??null,
    working:idle?.forecast.workingCount??null,idle:idle?.count??null,
    actualPerBiker:per&&!per.error?per.averageActualDaily:null,coverage:per&&!per.error?per.averageCoverage:null,
    qualityDetailsComplete:incompleteDetails.length===0,
    violations:snapshot?.metrics?.violations??null,cancellations:snapshot?.metrics?.cancelledByBiker??null,freeWashes:snapshot?.metrics?.freeWashCompensation??null,
    housingActive,housingInactive,vacancies,registered,workingBikes,repairBikes,nearDeadline,
    unknown:!washKnown||!bikers||!idle||!resources||!snapshot||!freshness?.savedAt,
  };
}
