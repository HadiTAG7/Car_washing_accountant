export const FLEET_STATUSES = Object.freeze([['working', 'شغال'], ['maintenance', 'صيانة'], ['stopped', 'متوقف'], ['missing', 'مفقود']]);
export const EXPECTED_FLEET_COUNT = 50;
export function fleetInventorySummary({bikes=[],maintenance=[]}) {
  return {registered:bikes.length,working:bikes.length?bikes.filter(b=>b.status==='working').length:null,
    maintenance:new Set([...maintenance.filter(m=>!m.endedOn).map(m=>m.bikeId),...bikes.filter(b=>b.status==='maintenance').map(b=>b.id)]).size,
    missing:Math.max(0,EXPECTED_FLEET_COUNT-bikes.length)};
}
export const CLAIM_STATUSES = Object.freeze([['none', 'ما فيه مطالبة'], ['pending', 'تحت المتابعة'], ['submitted', 'قُدمت'], ['accepted', 'قُبلت'], ['rejected', 'رُفضت'], ['closed', 'أُغلقت']]);
export const fleetDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const fleetDays = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const fleetIdentity = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
export const fleetPlate = value => fleetIdentity(value).replace(/[\s-]/g, '');
export function fleetPolicy(bike, policies, today) {
  if (bike.policyId) return policies.find(p => p.id === bike.policyId) || null;
  const candidates = policies.filter(p => p.wholeFleet && (!p.startsOn || p.startsOn <= today));
  return candidates.toSorted((a, b) => String(b.expiresOn).localeCompare(String(a.expiresOn)))[0] || null;
}
export function fleetSummary({ bikes = [], policies = [], maintenance = [], today }) {
  const openRepairs = new Set(maintenance.filter(m => !m.endedOn).map(m => m.bikeId));
  const available = bikes.filter(b => b.status === 'working' && !b.currentBikerId && !b.activeAssignmentId && !openRepairs.has(b.id));
  const longMaintenance = bikes.flatMap(bike => {
    const starts = maintenance.filter(m => m.bikeId === bike.id && !m.endedOn).map(m => m.startedOn);
    if (bike.status === 'maintenance' && bike.statusSince) starts.push(bike.statusSince);
    const since = starts.filter(fleetDay).sort()[0];
    return since && fleetDays(since, today) > 7 ? [{ bike, since, days: fleetDays(since, today) }] : [];
  });
  const usedPolicies = new Map(bikes.map(b => fleetPolicy(b, policies, today)).filter(Boolean).map(p => [p.id, p]));
  // A whole-fleet policy matters even before the 50 physical records arrive.
  const shared = fleetPolicy({}, policies, today); if (shared) usedPolicies.set(shared.id, shared);
  const insuranceAlerts = [...usedPolicies.values()].filter(p => fleetDay(p.expiresOn) && fleetDays(today, p.expiresOn) <= 30)
    .map(policy => ({ policy, days: fleetDays(today, policy.expiresOn) }));
  return { available, longMaintenance, insuranceAlerts };
}

export const FLEET_CSV_COLUMNS = Object.freeze(['internalNumber', 'plate', 'model', 'purchasedOn', 'startupItemId', 'status', 'statusSince', 'policyId']);
// RFC4180-style CSV, including BOM, quoted commas/newlines and double quotes.
// Preview only; no database call. A blank is unknown, never invented.
export function parseFleetCsv(text, existing = [], { today, startupIds, policyIds } = {}) {
  if (typeof text !== 'string' || text.length > 500000) throw Error('ملف CSV كبير أو غير صالح.');
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (!field && !closed) quoted = true;
      else throw Error('تنسيق الاقتباس في CSV غير صالح.');
    } else if (!quoted && (ch === ',' || ch === '\n' || ch === '\r')) {
      row.push(field); field = ''; closed = false;
      if (ch !== ',') { if (row.some(v => v.trim())) rows.push(row); row = []; if (ch === '\r' && text[i + 1] === '\n') i++; }
    } else { if (closed && ch.trim()) throw Error('يوجد نص بعد إغلاق الاقتباس في CSV.'); field += ch; }
  }
  if (quoted) throw Error('اقتباس CSV غير مكتمل.');
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  const headers = rows.shift()?.map((v, i) => (i === 0 ? v.replace(/^\uFEFF/, '') : v).trim());
  if (!headers || headers.length !== FLEET_CSV_COLUMNS.length || FLEET_CSV_COLUMNS.some((key, i) => headers[i] !== key)) throw Error('استخدم أعمدة قالب الأسطول وبالترتيب نفسه.');
  if (!rows.length || rows.length > 100) throw Error('أدخل من دباب واحد إلى 100 دباب في الملف.');
  const ids = new Set(existing.map(b => fleetIdentity(b.internalNumber))), plates = new Set(existing.map(b => fleetPlate(b.plate)).filter(Boolean));
  return rows.map((values, i) => {
    if (values.length !== headers.length) throw Error(`عدد خانات الصف ${i + 2} غير صحيح.`);
    const data = Object.fromEntries(headers.map((key, j) => [key, values[j].trim()]));
    if (!data.internalNumber || ids.has(fleetIdentity(data.internalNumber))) throw Error(`الرقم الداخلي مفقود أو مكرر في الصف ${i + 2}.`);
    if (data.plate && plates.has(fleetPlate(data.plate))) throw Error(`اللوحة مكررة في الصف ${i + 2}.`);
    if (!FLEET_STATUSES.some(([key]) => key === data.status) || ['purchasedOn', 'statusSince'].some(key => data[key] && !fleetDay(data[key]))
      || (data.status === 'maintenance' && !data.statusSince)) throw Error(`راجع الحالة والتواريخ في الصف ${i + 2}.`);
    if (data.internalNumber.length > 60 || data.plate.length > 60 || data.model.length > 120
      || today && [data.purchasedOn, data.statusSince].some(value => value > today)
      || data.startupItemId && startupIds && !startupIds.includes(data.startupItemId)
      || data.policyId && policyIds && !policyIds.includes(data.policyId)) throw Error(`راجع التواريخ والمراجع وطول البيانات في الصف ${i + 2}.`);
    ids.add(fleetIdentity(data.internalNumber)); if (data.plate) plates.add(fleetPlate(data.plate));
    return data;
  });
}
