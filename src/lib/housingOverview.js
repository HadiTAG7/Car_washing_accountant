import { normalizeUnitName } from './accounting/startupMigration.js';
import { departedBiker } from './idleBikers.js';
import { buildHousingRows, rentByUnit } from './housingStats.js';

const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const housingInactive = (biker, today) => departedBiker(biker) || (day(biker.endDate) && biker.endDate <= today);
export const housingBikerHref = id => `?page=bikers&bikerId=${encodeURIComponent(id)}`;

const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const plain = text => String(text || '').replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\s/g, '');
const arabicDate = (d, m, y) => `${y}-${String(months.indexOf(m) + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

/** Legacy lease evidence is narrative, not a payment schedule. Only accept
 * an explicit one-year range AND explicit annual price in reviewed purpose.
 * Never infer a contract from payment amount, stale notes, or shared budget.
 * Unsupported/conflicting evidence remains unknown with its source visible. */
export function housingLeaseEvidence(entry) {
  const text = plain(entry.housingEvidence?.purpose);
  const range = [...text.matchAll(new RegExp(`(\\d{1,2})(${months.join('|')})(\\d{4})[–—-](\\d{1,2})(${months.join('|')})(\\d{4})`, 'g'))];
  const prices = [...text.matchAll(/(?:؛|بسنةواحدة)([\d,.]+)(?:ولاخدمات|دونخدمات|ريال)/g)];
  if (range.length !== 1 || prices.length !== 1 || !/لمدةسنة|بسنةواحدة/.test(text)) return null;
  const [,d1,m1,y1,d2,m2,y2] = range[0];
  const from = arabicDate(d1,m1,y1), to = arabicDate(d2,m2,y2);
  const annual = Number(prices[0][1].replace(/,/g,''));
  if (!day(from) || !day(to) || annual <= 0 || !Number.isFinite(annual)) return null;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days < 364 || days > 365) return null;
  return { annual, from, to, sourceId: entry.id, sourceUrl: entry.invoiceUrl || '', sourceText: entry.housingEvidence.purpose };
}

export function housingOverview({ items = [], entries = [], bikers = [], metaRows = [], annualItems = [], annualEntries = [], today } = {}) {
  const rentItems = annualItems.filter(i => /سكن|إيجار|ايجار/.test(i.expenseName || '') && i.units?.length);
  const rentIndex = rentByUnit({ annualItems: rentItems, annualEntries });
  const setup = buildHousingRows({ items, entries, bikers, metaRows, rentIndex });
  const units = new Map();
  const add = name => {
    const key = normalizeUnitName(name);
    if (!key) return;
    if (!units.has(key)) units.set(key, { key, name, cost: 0, entryCount: 0 });
    return units.get(key);
  };
  for (const row of setup) for (const u of row.units) {
    const unit = add(u.name); unit.cost += u.cost; unit.entryCount += u.entryCount;
  }
  for (const m of metaRows) add(m.name);
  for (const i of rentItems) for (const name of i.units) add(name);
  // Tagged payments may identify a real unit even before a plan is updated.
  for (const r of rentIndex.byUnit.values()) add(r.name);
  const rows = [...units.values()].map(u => {
    const meta = metaRows.find(m => normalizeUnitName(m.name) === u.key);
    const residents = bikers.filter(b => normalizeUnitName(b.residence) === u.key);
    const inactive = residents.filter(b => housingInactive(b, today));
    const active = residents.filter(b => !housingInactive(b, today));
    const capacity = meta?.capacity ?? null;
    const ownPayments = annualEntries.filter(e => rentItems.some(i => i.id === e.annualExpenseId) && normalizeUnitName(e.unit) === u.key);
    const evidence = ownPayments.map(housingLeaseEvidence).filter(Boolean).filter(c => c.from <= today && c.to >= today);
    const unique = new Map(evidence.map(c => [`${c.from}:${c.to}:${c.annual}`,c]));
    const contract = unique.size === 1 ? [...unique.values()][0] : null;
    // A single-unit annual plan has an unambiguous allocation, but still no
    // contract dates/schedule. Shared plans must NOT be divided evenly.
    const singlePlans = rentItems.filter(i => i.units.length === 1 && normalizeUnitName(i.units[0]) === u.key);
    const annual = contract?.annual ?? (singlePlans.length === 1 && Number(singlePlans[0].annualCost) > 0 ? Number(singlePlans[0].annualCost) : null);
    const monthly = annual === null ? null : money(annual / 12);
    const contractPayments = contract ? ownPayments.filter(e => (e.spentDate >= contract.from && e.spentDate <= contract.to) || e.id === contract.sourceId) : ownPayments;
    const recorded = money(ownPayments.reduce((n,e) => n + (Number(e.amount) || 0),0));
    const paid = money(contractPayments.filter(e => e.housingEvidence?.paymentStatus === 'paid').reduce((n,e) => n + (Number(e.amount) || 0),0));
    const unconfirmed = contractPayments.some(e => e.housingEvidence?.paymentStatus !== 'paid');
    const remaining = annual === null || unconfirmed ? null : money(Math.max(0, annual - paid));
    const plan = singlePlans.length === 1 ? singlePlans[0] : null;
    const dueDate = plan?.paymentMonth && plan?.paymentDay
      ? `${today.slice(0,4)}-${String(plan.paymentMonth).padStart(2,'0')}-${String(plan.paymentDay).padStart(2,'0')}` : '';
    // Only a dedicated unit's explicit annual plan can supply its due date.
    // A passed unpaid date stays overdue; do not silently roll it to next year.
    const nextPayment = remaining !== null && remaining > 0 && day(dueDate)
      ? { date:dueDate, days:Math.round((Date.parse(dueDate)-Date.parse(today))/86400000), amount:remaining } : null;
    const missing = [];
    if (annual === null) missing.push('قيمة العقد السنوية لهذا السكن');
    if (!contract) missing.push('بداية العقد ونهايته');
    if (unconfirmed) missing.push('إثبات سداد الدفعات');
    // There is no per-unit installment schedule in the current source. The
    // parent paymentMonth/day belongs to a shared plan, not each contract.
    if (!nextPayment) missing.push('جدول الدفعات القادمة');
    return { ...u, capacity, residents, active, inactive, notes: meta?.notes || '',
      vacant: capacity === null ? null : Math.max(0,capacity - residents.length),
      afterEviction: capacity === null ? null : Math.max(0,capacity - active.length),
      overCapacity: capacity !== null && residents.length > capacity,
      recorded, paid, unconfirmed, annual, monthly, remaining, contract,
      perActiveMonthly: monthly !== null && active.length ? money(monthly / active.length) : null,
      payments: ownPayments, missing, nextPayment,
    };
  });
  const unhoused = bikers.filter(b => !housingInactive(b,today) && !units.has(normalizeUnitName(b.residence)));
  return { rows, unhoused, rentUnassigned: rentIndex.unassigned,
    setupUnassigned: money(setup.reduce((n,r) => n + r.unassignedCost,0)),
    sharedPlans: rentItems.filter(i => i.units.length > 1),
    alerts: rows.flatMap(u => [
      ...(u.inactive.length ? [{ kind:'inactive',unit:u.name,count:u.inactive.length }] : []),
      ...(u.capacity !== null && u.vacant === 0 && unhoused.length ? [{ kind:'full',unit:u.name,count:unhoused.length }] : []),
      ...(u.nextPayment && u.nextPayment.days <= 30 ? [{ kind:'due',unit:u.name,...u.nextPayment }] : []),
    ]),
  };
}
