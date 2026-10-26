import { COMPENSATION_KEYS } from '../../functions/src/sweater/metricsContract.js';
import { displayBikerName } from './bikerNames.js';
export function previousQualityMonth(month) {
  const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1); return date.toISOString().slice(0, 7);
}
export function qualityBikerRows(snapshot, bikers) {
  const events = COMPENSATION_KEYS.flatMap(key => (snapshot?.eventGroups?.[key]?.rows || []).map(row => ({ ...row, snapshotId: snapshot.metricSources[key].snapshotId })));
  const ids = new Map();
  for (const biker of bikers) {
    const external = String(biker.driverExternalId || '').trim();
    if (external) ids.set(external, [...(ids.get(external) || []), biker]);
  }
  // A duplicate registry link does not prove who caused a source event.
  const rows = bikers.map(biker => ({ id: biker.id, biker, name: displayBikerName(biker), externalId: String(biker.driverExternalId || ''), events: [] }));
  const unknown = new Map();
  for (const event of events) {
    const matches = ids.get(event.driverExternalId) || [];
    if (matches.length === 1) rows.find(row => row.id === matches[0].id).events.push(event);
    else {
      const key = event.driverExternalId || 'unattributed';
      if (!unknown.has(key)) unknown.set(key, { id: `source:${key}`, name: !event.driverExternalId ? 'بدون بايكر في المصدر' : matches.length ? 'ربط سويتر مكرر؛ يحتاج مراجعة' : 'بايكر غير مربوط بالموقع', externalId: event.driverExternalId, events: [] });
      unknown.get(key).events.push(event);
    }
  }
  return [...rows, ...unknown.values()].map(row => ({ ...row, values: Object.fromEntries(COMPENSATION_KEYS.map(key => {
    const group = snapshot?.eventGroups?.[key], own = row.events.filter(e => e.metricKey === key);
    const unambiguous = !row.biker || (row.externalId && ids.get(row.externalId)?.length === 1);
    const complete = Boolean(group?.complete && group.rows.every(r => r.driverExternalId !== null) && unambiguous);
    const isMoney = ['violations', 'damages', 'compensations'].includes(key);
    const value = own.length ? (isMoney && own.some(e => e.amount === null) ? null : own.reduce((sum, e) => sum + (isMoney ? e.amount : e.quantity), 0)) : complete ? 0 : null;
    return [key, { value, partial: !complete }];
  })) })).sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name, 'ar'));
}
