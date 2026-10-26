import { OPERATIONS_SETTINGS } from '../config/operationsSettings.js';

const instant = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

/** Only actual successful saves refresh this clock; heartbeats and failed runs do not. */
export function operationFreshness(state, now = Date.now(), settings = OPERATIONS_SETTINGS) {
  const latest = [
    { savedAt: state?.lastSuccessAtIso, coverage: state?.lastCoverage },
    { savedAt: state?.lastOperationalSuccessAtIso, coverage: state?.lastOperationalCoverage },
  ].filter(p => instant(p.savedAt) !== null && instant(p.savedAt) <= now)
    .sort((a, b) => instant(b.savedAt) - instant(a.savedAt))[0];
  if (!latest) return { savedAt: null, observedAt: null, savedAgeHours: null, ageHours: null, tone: 'red', coverage: null };
  const observed = instant(latest.coverage?.extractedAt);
  const observedAt = observed !== null && observed <= now ? latest.coverage.extractedAt : null;
  const savedAgeHours = (now - instant(latest.savedAt)) / 36e5;
  const ageHours = (now - Math.min(instant(latest.savedAt), observedAt ? observed : instant(latest.savedAt))) / 36e5;
  const sourceTimeUncertain = latest.coverage?.extractedAt != null && observedAt === null;
  return { ...latest, observedAt, savedAgeHours, ageHours, sourceTimeUncertain,
    tone: sourceTimeUncertain || ageHours > settings.freshnessCriticalHours ? 'red'
      : ageHours > settings.freshnessWarningHours ? 'yellow' : 'green' };
}

export const importStamp = (iso, language = 'ar') => iso ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory',
  { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: 'Asia/Riyadh', numberingSystem: 'latn' }).format(new Date(iso))
  : language === 'en' ? 'Unavailable' : 'غير متاح';

export function recentImportRuns(runs, now = Date.now(), settings = OPERATIONS_SETTINGS) {
  const since = now - settings.importHistoryDays * 86400000;
  return runs.filter(r => instant(r.startedAtIso) !== null && instant(r.startedAtIso) >= since && instant(r.startedAtIso) <= now)
    .sort((a, b) => instant(b.startedAtIso) - instant(a.startedAtIso));
}

export function importRunErrors(run) {
  const result = run.result || {};
  const rejected = (result.rows || []).filter(r => r.outcome === 'rejected');
  const errors = [...(Array.isArray(result.errors) ? result.errors : []), ...(Array.isArray(run.errors) ? run.errors : []),
    run.error?.message || run.error, result.error?.message || result.error,
    ...rejected.map(r => r.reasonAr || r.reason || r.reasonCode || 'سجل مرفوض')]
    .filter(x => typeof x === 'string' && x.trim());
  return [...new Set(errors)];
}
