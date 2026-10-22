#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// بيانات تجريبية بحجم الإنتاج — للمحاكي وحده
// ═══════════════════════════════════════════════════════════════════════════
// تُبنى من `counts.json` (أحجام المجموعات) ببذرة ثابتة، فكل تشغيل يعطي نفس
// البيانات ونفس عدد القراءات. المستندات تُشكَّل بمحوّلات التطبيق نفسها
// (`src/lib/mappers.js`)، والقيود والرواتب تمرّ بالخادم الموثوق (`dispatch`)
// لا تُكتب يدوياً — فما يُقاس هو ما يقرؤه التطبيق فعلاً.
//
// يرفض العمل خارج المحاكي: بلا FIRESTORE_EMULATOR_HOST وFIREBASE_AUTH_EMULATOR_HOST
// ومشروع يبدأ بـ demo- لا يكتب شيئاً.
//
//   firebase emulators:exec --only firestore,auth --project demo-sweater \
//     "node scripts/emulator/seed.mjs"
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { dispatch } from '../../functions/src/handlers.js';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/accounting/chartOfAccounts.js';
import { buildVoucher } from '../../src/lib/accounting/recurring.js';
import {
  toWashInsert, toBikerInsert, toVariableExpenseInsert, toMonthlyExpenseInsert,
  toAnnualExpenseInsert, toAnnualExpenseEntryInsert, toTemporaryExpenseInsert,
  toPartnerInsert, toPartnerPaymentInsert, toStartupCostInsert, toStartupCostEntryInsert,
  toHousingUnitInsert,
} from '../../src/lib/mappers.js';
import { ACCOUNTS, PASSWORD } from './accounts.mjs';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-sweater';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !PROJECT.startsWith('demo-')) {
  console.error('seed.mjs runs against the emulators only (FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, demo-* project).');
  process.exit(2);
}


const config = JSON.parse(readFileSync(new URL(process.env.SEED_COUNTS || './counts.json', import.meta.url), 'utf8'));
const size = name => Math.max(0, Number(config.collections?.[name]) || 0);

// Deterministic PRNG (mulberry32): the same counts give the same documents.
let state = 20261021;
const rand = () => {
  state = (state + 0x6D2B79F5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = list => list[Math.floor(rand() * list.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pad = n => String(n).padStart(2, '0');

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const monthKey = (y, m) => `${y}-${pad(m)}`;
const addMonths = (key, n) => { const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + n, 1)); return monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1); };
const daysIn = key => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();
const currentMonth = today.slice(0, 7);
const months = Array.from({ length: Math.max(2, Number(config.months) || 6) }, (_, i) => addMonths(currentMonth, i - (Math.max(2, Number(config.months) || 6) - 1)));
const lastDay = key => (key === currentMonth ? Number(today.slice(8, 10)) : daysIn(key));
const dayIn = key => `${key}-${pad(int(1, lastDay(key)))}`;

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

async function writeAll(name, rows) {
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    for (const { id, ...data } of rows.slice(i, i + 400)) batch.set(id ? db.collection(name).doc(id) : db.collection(name).doc(), data);
    await batch.commit();
  }
}
async function account(email, role) {
  const user = await auth.createUser({ email, password: PASSWORD }).catch(() => auth.getUserByEmail(email));
  await db.collection('users').doc(user.uid).set({ email, role });
  if (role === 'admin') await db.collection('app_admins').doc(user.uid).set({ note: 'emulator seed' });
  return user.uid;
}

const adminUid = await account(ACCOUNTS.admin, 'admin');
const partnerUid = await account(ACCOUNTS.partner, 'partner');
const asAdmin = (name, data) => dispatch(db, FieldValue, name, data, { uid: adminUid, token: {} });

await asAdmin('ledgerSeedChart', { accounts: DEFAULT_CHART_OF_ACCOUNTS });
await db.collection('app_settings').doc('accounting').set({ value: { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 } });
await asAdmin('accountingSeedTaxPolicy', { baselineFrom: `${months[0]}-01` });
await writeAll('fee_rules', [
  { id: 'management', key: 'management', label: 'رسوم الإدارة', rate: 0.10, basis: 'profit', active: true },
  { id: 'supervisor', key: 'supervisor', label: 'حصة المشرف', rate: 0.05, basis: 'profit', active: true },
]);

// ── People ──
const bikers = Array.from({ length: size('bikers') }, (_, i) => ({ id: `b${pad(i + 1)}`, ...toBikerInsert({
  name: `بايكر ${i + 1}`, nameEnglish: `Biker ${i + 1}`, driverExternalId: String(1000 + i),
  salary: pick([1500, 1800, 2000, 2200]), startDate: `${months[0]}-01`, currentStatus: 'يشتغل',
}) }));
await writeAll('bikers', bikers);
const partnerCount = Math.max(1, size('partners'));
const perPartner = Math.max(1, Math.round(bikers.length / partnerCount));
await writeAll('partners', Array.from({ length: partnerCount }, (_, i) => ({ id: `p${i + 1}`,
  ...toPartnerInsert({ partnerName: `شريك ${i + 1}`, workersCount: perPartner, userId: i === 0 ? partnerUid : null }),
  ...(i === 0 ? { user_id: partnerUid } : {}), status: 'active' })));
await writeAll('partner_payments', Array.from({ length: size('partner_payments') }, (_, i) => ({ id: `pp${i + 1}`,
  ...toPartnerPaymentInsert({ partnerId: `p${(i % partnerCount) + 1}`, amount: 20000, paymentDate: dayIn(months[i % 2]), paymentMethod: 'bank_transfer' }) })));
await writeAll('housing_units', Array.from({ length: size('housing_units') }, (_, i) => ({ id: `u${i + 1}`, ...toHousingUnitInsert({ id: `u${i + 1}`, name: `سكن ${i + 1}`, capacity: 12 }) })));

// ── Washes and Sweater bookings ──
const weights = months.map(key => lastDay(key));
const totalDays = weights.reduce((s, n) => s + n, 0);
const washes = []; const bookings = [];
let washSeq = 0;
for (const [index, key] of months.entries()) {
  const target = Math.round(size('washes') * weights[index] / totalDays);
  for (let i = 0; i < target; i += 1) {
    washSeq += 1;
    const biker = pick(bikers);
    const direct = rand() < (config.directWashShare ?? 0.15);
    const date = dayIn(key);
    const ssp = direct ? null : `SSP-${700000 + washSeq}`;
    const row = { id: `w${String(washSeq).padStart(6, '0')}`, ...toWashInsert({
      bikerName: biker.name, bikerId: biker.id, quantity: 1, price: 23, washDate: date,
      status: key === currentMonth && date === today && rand() < 0.3 ? 'قيد التنفيذ' : 'مكتملة',
      paymentMethod: 'cash', revenueOrigin: direct ? 'direct' : 'sweater', sspBookingId: ssp,
    }) };
    if (!direct) row.payment_method = null;
    washes.push(row);
    if (ssp && bookings.length < size('sweater_bookings')) bookings.push({ id: ssp, sspBookingId: ssp, periodKey: key, serviceDate: date,
      bikerId: biker.id, bikerName: biker.name, quantity: 1, status: 'completed', amount: 23, netAmount: 20, vatAmount: 3 });
  }
}
await writeAll('washes', washes);
await writeAll('sweater_bookings', bookings);
await writeAll('sweater_settlements', months.filter(k => k !== currentMonth).map(k => ({ id: k, periodKey: k, status: 'draft',
  from: `${k}-01`, to: `${k}-${pad(daysIn(k))}`, grossAmount: 0, netAmount: 0, vatAmount: 0, figures: { lines: { eligible: [] } } })));

// ── Expenses ──
const variables = Array.from({ length: size('variable_expenses') }, (_, i) => {
  const key = months[i % months.length];
  return { id: `ve${pad(i + 1)}`, ...toVariableExpenseInsert({ expenseName: pick(['مواد تنظيف', 'وقود', 'صيانة دراجة', 'مستلزمات']),
    quantity: 1, unitCost: int(50, 900), loggedDate: dayIn(key), paymentMethod: 'cash' }) };
});
await writeAll('variable_expenses', variables);
const templates = Array.from({ length: Math.round(size('monthly_expenses') * 0.75) }, (_, i) => ({ id: `me${pad(i + 1)}`,
  ...toMonthlyExpenseInsert({ expenseName: pick(['إيجار سكن', 'إنترنت', 'اشتراك نظام', 'تأمين']), quantity: 1, unitCost: int(200, 4000), paymentDay: int(1, 28), recurrence: 'monthly' }) }));
const oneTime = Array.from({ length: size('monthly_expenses') - templates.length }, (_, i) => ({ id: `mo${pad(i + 1)}`,
  ...toMonthlyExpenseInsert({ expenseName: 'مصروف لمرة واحدة', quantity: 1, unitCost: int(100, 1500), recurrence: 'one_time', loggedDate: dayIn(months[i % months.length]) }) }));
await writeAll('monthly_expenses', [...templates, ...oneTime]);
const vouchers = [];
for (const key of months) for (const t of templates) {
  const v = buildVoucher({ id: t.id, expenseName: t.expense_name, totalMonthlyCost: t.total_monthly_cost, quantity: 1, unitCost: t.unit_cost, paymentDay: t.payment_day }, key);
  vouchers.push({ ...v, status: key === currentMonth ? 'pending' : 'paid' });
}
await writeAll('expense_vouchers', vouchers);
const annuals = Array.from({ length: size('annual_expenses') }, (_, i) => ({ id: `ae${pad(i + 1)}`,
  ...toAnnualExpenseInsert({ expenseName: pick(['إقامات', 'رخص', 'تأمين طبي']), category: 'general', quantity: 1, annualCost: int(5000, 40000), paymentMonth: 1, paymentDay: 1 }) }));
await writeAll('annual_expenses', annuals);
await writeAll('annual_expense_entries', Array.from({ length: size('annual_expense_entries') }, (_, i) => ({ id: `aee${pad(i + 1)}`,
  ...toAnnualExpenseEntryInsert({ annualExpenseId: annuals[i % Math.max(1, annuals.length)]?.id, description: 'دفعة', amount: int(1000, 8000), spentDate: dayIn(months[i % months.length]) }) })));
await writeAll('temporary_expenses', Array.from({ length: size('temporary_expenses') }, (_, i) => {
  const key = months[i % months.length];
  return { id: `te${pad(i + 1)}`, ...toTemporaryExpenseInsert({ title: 'سلفة', amount: int(100, 800), spentDate: dayIn(key), bikerId: pick(bikers).id,
    status: key === currentMonth ? 'pending' : 'recovered', recoveredDate: key === currentMonth ? null : `${key}-${pad(daysIn(key))}`, paymentMethod: 'cash' }) };
}));
const startups = Array.from({ length: size('startup_costs') }, (_, i) => ({ id: `sc${pad(i + 1)}`, ...toStartupCostInsert({ itemName: `بند تأسيس ${i + 1}`, category: 'equipment', quantity: 1, plannedAmount: int(1000, 10000) }) }));
await writeAll('startup_costs', startups);
await writeAll('startup_cost_entries', Array.from({ length: size('startup_cost_entries') }, (_, i) => ({ id: `sce${pad(i + 1)}`,
  ...toStartupCostEntryInsert({ startupCostId: startups[i % Math.max(1, startups.length)]?.id, amount: int(500, 5000), spentDate: dayIn(months[0]), paymentMethod: 'bank' }) })));
await writeAll('biker_quality_reports', Array.from({ length: size('biker_quality_reports') }, (_, i) => {
  const biker = bikers[i % bikers.length]; const key = months[months.length - 1 - (Math.floor(i / bikers.length) % months.length)];
  return { id: `q${pad(i + 1)}`, bikerUID: biker.id, periodKey: key, rulesVersion: 'v1', from: `${key}-01`, to: `${key}-${pad(lastDay(key))}`, score: int(60, 100) };
}));

// ── Books: post through the trusted server ──
const completed = months.filter(k => k !== currentMonth);
let posted = 0; const failures = new Map();
const post = async (kind, sourceId) => {
  try { await asAdmin('ledgerPostSource', { kind, sourceId }); posted += 1; }
  catch (e) { failures.set(e.message, (failures.get(e.message) || 0) + 1); }
};
for (const w of washes) if (w.revenue_origin === 'direct' && w.status === 'مكتملة' && completed.includes(w.wash_date.slice(0, 7))) await post('wash', w.id);
for (const v of variables) if (completed.includes(v.logged_date.slice(0, 7)) && rand() < (config.postedExpenseShare ?? 0.5)) await post('variable', v.id);
for (const v of vouchers) if (v.status === 'paid' && rand() < (config.postedExpenseShare ?? 0.5)) await post('voucher', v.id);

// ── Payroll: older months paid, the previous month approved, this month open ──
for (const [index, key] of completed.entries()) {
  try {
    const saved = await asAdmin('payrollSaveDraft', { periodKey: key, periodStart: `${key}-01`, periodEnd: `${key}-${pad(daysIn(key))}`, adjustments: [] });
    await asAdmin('payrollApprove', { runId: saved.runId });
    if (index < completed.length - 1) await asAdmin('payrollPay', { runId: saved.runId, paymentMethod: 'bank' });
  } catch (e) { failures.set(`payroll ${key}: ${e.message}`, 1); }
}

const counts = {};
for (const c of await db.listCollections()) counts[c.id] = (await c.count().get()).data().count;
console.log(JSON.stringify({ today, months, posted, failures: Object.fromEntries(failures), counts }, null, 2));
