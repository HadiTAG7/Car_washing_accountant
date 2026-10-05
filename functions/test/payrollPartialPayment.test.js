import { expect, it } from 'vitest';
import { previewPartialPayrollPayment, recordPartialPayrollPayment, savePayrollDraft, approvePayroll, reversePayroll, payPayroll, previewPayroll, cancelPayroll, unapprovePayroll } from '../src/payroll.js';
import { dispatch } from '../src/handlers.js';
const runId = '2026-09__r1';
const now = new Date('2026-10-05T08:00:00Z');
const FV = { serverTimestamp: () => 'synthetic-server-time' };
const item = (i, extra = {}) => ({ bikerId: `worker-${i}`, name: `Synthetic ${i}`, status: 'draft', basicDue: 870, commission: 0, bonus: 0,
  deduction: 0, advanceDeduction: 0, advanceAllocations: [], netDue: 870, ...extra });
function fixture() {
  const rows = new Map([
    [`payroll_runs/${runId}`, { runId, revision: 1, periodKey: '2026-09', status: 'draft', distributionDate: '2026-10-01',
      policySnapshot: { commission: { unitAmount: 2, version: 'completed_wash_v1' } }, distributionSnapshot: {}, totals: { basic: 24360, commissions: 0, bonuses: 0, deductions: 0, advances: 0, net: 24360 } }],
    ['payroll_periods/2026-09', { revision: 1, currentRunId: runId }],
    ['users/admin', { role: 'admin' }], ['users/accountant', { role: 'accountant' }], ['users/operator', { role: 'operator' }],
    ['users/partner', { role: 'partner' }], ['users/supervisor', { role: 'supervisor' }],
  ]);
  for (let i = 1; i <= 28; i++) rows.set(`payroll_runs/${runId}/items/worker-${i}`, item(i));
  const writes = []; let auto = 0;
  const snap = path => ({ id: path.split('/').at(-1), ref: ref(path), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const ref = path => ({ id: path.split('/').at(-1), path, get: async () => snap(path), collection: name => collection(`${path}/${name}`) });
  const collection = path => ({ doc: id => ref(`${path}/${id ?? `auto-${++auto}`}`), get: async () => {
    const docs = [...rows.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(snap);
    return { docs, empty: !docs.length };
  } });
  return { rows, writes, collection, runTransaction: async callback => {
    const pending = []; let didWrite = false;
    const result = await callback({ get: async reference => { if (didWrite) throw Error('read after write'); return reference.get(); },
      set: (reference, value, options) => { didWrite = true; pending.push(['set', reference.path, value, options]); },
      update: (reference, value) => { didWrite = true; pending.push(['set', reference.path, value, { merge: true }]); },
      delete: reference => { didWrite = true; pending.push(['delete', reference.path]); },
    });
    for (const [kind, path, value, options] of pending) { if (kind === 'delete') rows.delete(path); else rows.set(path, options?.merge ? { ...rows.get(path), ...structuredClone(value) } : structuredClone(value)); writes.push(path); }
    return result;
  } };
}
const ids = Array.from({ length: 8 }, (_, i) => `worker-${i + 1}`);
const request = extra => ({ runId, bikerIds: ids, paymentMethod: 'cash', payDate: '2026-10-05', recordedNetAmount: 6960, reason: 'Owner confirmed external payment', ...extra });
const preview = (db, payload = request()) => previewPartialPayrollPayment(db, payload, { now });
const record = (db, payload) => recordPartialPayrollPayment(db, FV, payload, { now, userId: 'admin' });
it('read-only preview names exactly8 IDs with saved gross/advance/net; detects6310 vs6960 mismatch', async () => {
  const db = fixture(); const before = structuredClone([...db.rows]);
  const p = await preview(db, request({ recordedNetAmount: 6310 }));
  expect(p).toMatchObject({ selectedCount: 8, remainingCount: 20, gross: 6960, totals: { advances: 0, net: 6960 }, matchesRecordedAmount: false });
  expect(p.lines.map(x => x.bikerId).sort()).toEqual([...ids].sort());
  expect(db.writes).toEqual([]); expect([...db.rows]).toEqual(before);
  await expect(record(db, { ...request({ recordedNetAmount: 6310 }), previewHash: p.previewHash, recordedExternally: true })).rejects.toThrow(/لا يطابق/);
  expect(db.writes).toEqual([]);
});
it('records selected8 only, preserves20 rows byte-for-byte, posts balanced subset, locks IDs and audits actual date/method', async () => {
  const db = fixture(); const unselected = [...db.rows].filter(([path]) => /items\//.test(path) && !ids.includes(path.split('/').at(-1)));
  const p = await preview(db); const result = await record(db, { ...request(), previewHash: p.previewHash, recordedExternally: true });
  expect(result).toMatchObject({ status: 'partially_paid', selectedCount: 8, remainingCount: 20, payDate: '2026-10-05', totals: { net: 6960 } });
  expect(unselected.every(([path, row]) => JSON.stringify(db.rows.get(path)) === JSON.stringify(row))).toBe(true);
  expect(ids.every(id => db.rows.get(`payroll_runs/${runId}/items/${id}`).status === 'paid')).toBe(true);
  expect(db.rows.get(`payroll_runs/${runId}`)).toMatchObject({ status: 'partially_paid', partialPayments: true, paymentSummary: { paidCount: 8, remainingCount: 20 } });
  const journal = db.rows.get(`journal_entries/${result.entryId}`);
  expect(journal.totalDebit).toBe(journal.totalCredit);
  expect(journal).toMatchObject({ entryDate: '2026-10-05', payrollSnapshot: { totals: { net: 6960 }, recordedExternally: true, bikerIds: [...ids].sort() } });
  expect([...db.rows.keys()].filter(path => path.startsWith('payroll_payment_locks/'))).toHaveLength(8);
  const audit = [...db.rows].find(([path]) => path.startsWith('audit_logs/'))[1];
  expect(audit).toMatchObject({ action: 'payroll-record-partial-payment' });
  const paidBefore = structuredClone(ids.map(id => db.rows.get(`payroll_runs/${runId}/items/${id}`)));
  const remaining = request({ bikerIds: Array.from({ length: 20 }, (_, i) => `worker-${i + 9}`), recordedNetAmount: 17400, paymentMethod: 'bank', paymentReference: 'Synthetic bank ref' });
  const second = await preview(db, remaining); await record(db, { ...remaining, previewHash: second.previewHash, recordedExternally: true });
  expect(db.rows.get(`payroll_runs/${runId}`).status).toBe('paid');
  expect(ids.map(id => db.rows.get(`payroll_runs/${runId}/items/${id}`))).toEqual(paidBefore);
  await expect(reversePayroll(db, FV, { runId, reason: 'Test', reverseDate: '2026-10-05' }, { now })).rejects.toThrow(/كل دفعة/);
});
it('identical retry returns receipt without journal/locks/audit duplication; paid workers cannot join a new batch', async () => {
  const db = fixture(); const p = await preview(db); const payload = { ...request(), previewHash: p.previewHash, recordedExternally: true };
  const first = await record(db, payload); const writes = db.writes.length;
  expect(await record(db, payload)).toMatchObject({ entryId: first.entryId, replay: true }); expect(db.writes).toHaveLength(writes);
  await expect(preview(db, request({ bikerIds: ['worker-1', 'worker-9'], recordedNetAmount: 1740 }))).rejects.toThrow(/سبق تسجيل/);
  await expect(record(db, { ...payload, paymentMethod: 'bank' })).rejects.toThrow(/لا يطابق طلب/);
});
it('changed saved amounts invalidate preview; closed period and prior lock fail atomically', async () => {
  for (const change of [db => { db.rows.get(`payroll_runs/${runId}/items/worker-1`).bonus = 10; db.rows.get(`payroll_runs/${runId}/items/worker-1`).netDue = 880; },
    db => db.rows.set('accounting_periods/2026-10', { status: 'closed' }), db => db.rows.set('payroll_payment_locks/2026-09__worker-1', { runId: 'prior' })]) {
    const db = fixture(); const p = await preview(db); change(db); const before = structuredClone([...db.rows]);
    await expect(record(db, { ...request(), previewHash: p.previewHash, recordedExternally: true })).rejects.toThrow();
    expect([...db.rows]).toEqual(before); expect(db.writes).toEqual([]);
  }
});
it('deducts only saved selected advance allocations; rejects changed recovery before any write', async () => {
  const db = fixture();
  db.rows.set('temporary_expenses/a', { biker_id: 'worker-1', amount: 90, status: 'pending', recovered_amount: 0, assignment_month: '2026-09', spent_date: '2026-09-03' });
  const row = db.rows.get(`payroll_runs/${runId}/items/worker-1`); row.advanceDeduction = 90; row.netDue = 780;
  row.advanceAllocations = [{ advanceId: 'a', amount: 90, expectedOutstanding: 90, assignmentMonth: '2026-09' }];
  const payload = request({ recordedNetAmount: 6870 }); const p = await preview(db, payload);
  await record(db, { ...payload, previewHash: p.previewHash, recordedExternally: true });
  expect(db.rows.get('temporary_expenses/a')).toMatchObject({ recovered_amount: 90, status: 'recovered', recovered_date: '2026-10-05' });
  const db2 = fixture(); db2.rows.set('temporary_expenses/a', { ...db.rows.get('temporary_expenses/a') });
  db2.rows.set(`payroll_runs/${runId}/items/worker-1`, { ...row }); const p2 = await preview(db2, payload);
  await expect(record(db2, { ...payload, previewHash: p2.previewHash, recordedExternally: true })).rejects.toThrow(/تغير رصيد/); expect(db2.writes).toEqual([]);
});
it.each(['accountant', 'operator', 'partner', 'supervisor'])('stored%s role cannot preview or record despite a forged admin payload', async role => {
  const db = fixture();
  for (const name of ['payrollPreviewPartialPayment', 'payrollRecordPartialPayment']) {
    await expect(dispatch(db, FV, name, { ...request(), role: 'admin' }, { uid: role, token: { role: 'admin' } })).rejects.toMatchObject({ code: 'permission-denied' });
  }
  expect(db.writes).toEqual([]);
});
it('requires explicit real date/method, confirmation and IDs; partial runs cannot be overwritten or approved as a whole', async () => {
  const db = fixture();
  for (const payload of [request({ paymentMethod: '' }), request({ payDate: '' }), request({ payDate: '2026-10-06' }), request({ bikerIds: [] }), request({ bikerIds: ['worker-1', 'worker-1'] }), request({ bikerIds: ['not-in-run'] })]) await expect(preview(db, payload)).rejects.toThrow();
  const p = await preview(db);
  await expect(record(db, { ...request(), previewHash: p.previewHash })).rejects.toThrow(/تأكيد/);
  await record(db, { ...request(), previewHash: p.previewHash, recordedExternally: true });
  await expect(savePayrollDraft(db, FV, { periodKey: '2026-09' })).rejects.toThrow();
  await expect(approvePayroll(db, FV, { runId })).rejects.toThrow();
});

it('existing full approved-payroll route still pays the complete run with its fixed distribution date', async () => {
  const db = fixture(); db.rows.get(`payroll_runs/${runId}`).status = 'approved';
  for (let i=1;i<=28;i++) db.rows.get(`payroll_runs/${runId}/items/worker-${i}`).status='approved';
  const result = await payPayroll(db, FV, { runId, paymentMethod: 'bank', payDate: '2026-10-01' }, { now, userId: 'admin' });
  expect(result).toMatchObject({ status:'paid', totals:{net:24360}, payDate:'2026-10-01' });
  expect([...db.rows.keys()].filter(path=>path.startsWith('payroll_payment_locks/'))).toHaveLength(28);
  expect(db.rows.get(`payroll_runs/${runId}`).partialPayments).toBeUndefined();
});
it.each([
  ['linked legacy salary', db => db.rows.set('monthly_expenses/old-salary', { biker_id: 'worker-1', salary_month: '2026-09', expense_name: 'Salary', payment_status: 'مدفوع', total_monthly_cost: 870, logged_date: '2026-10-03' })],
  ['legacy name-only salary', db => db.rows.set('monthly_expenses/name-salary', { expense_name: 'راتب — Synthetic 1', payment_status: 'مدفوع', total_monthly_cost: 870, logged_date: '2026-10-03' })],
  ['unattributed group of5', db => db.rows.set('monthly_expenses/group-of-five', { expense_name: 'رواتب خمسة عمال', payment_status: 'مدفوع', total_monthly_cost: 4350, logged_date: '2026-10-03' })],
  ['paid item inside another draft run', db => { db.rows.set('payroll_runs/legacy', { runId:'legacy',status:'draft',periodKey:'2026-09' });db.rows.set('payroll_runs/legacy/items/worker-1', { ...item(1),status:'paid',payDate:'2026-10-03' }); }],
  ['journal-only payroll', db => db.rows.set('journal_entries/prior', { status:'posted',sourceType:'payroll',sourceId:'legacy',entryDate:'2026-10-03',payrollSnapshot:{periodKey:'2026-09',bikerIds:['worker-1'],totals:{net:870}} })],
])('blocks%s despite the current aggregate remaining a draft, before any write', async (_label, add) => {
  const db=fixture();add(db);const before=structuredClone([...db.rows]);const p=await preview(db);
  expect(p.canRecord).toBe(false);expect(p.historicalPayments.length).toBeGreaterThan(0);
  await expect(record(db,{...request(),previewHash:p.previewHash,recordedExternally:true})).rejects.toThrow(/أدلة سداد/);
  expect(db.writes).toEqual([]);expect([...db.rows]).toEqual(before);
});
it('a legacy salary recorded after preview invalidates confirmation; explicit other-month/other-ID payments do not block', async () => {
  const db=fixture();db.rows.set('monthly_expenses/old-month',{biker_id:'worker-1',salary_month:'2026-08',expense_name:'Salary',payment_status:'مدفوع',logged_date:'2026-10-02'});
  db.rows.set('monthly_expenses/other-worker',{biker_id:'worker-28',salary_month:'2026-09',expense_name:'Salary',payment_status:'مدفوع',logged_date:'2026-10-02'});
  const p=await preview(db);expect(p.canRecord).toBe(true);
  db.rows.set('monthly_expenses/new-evidence',{biker_id:'worker-1',salary_month:'2026-09',expense_name:'Salary',payment_status:'مدفوع',logged_date:'2026-10-03'});
  await expect(record(db,{...request(),previewHash:p.previewHash,recordedExternally:true})).rejects.toThrow(/تغيرت معاينة/);expect(db.writes).toEqual([]);
});
it('explicit650 recovery reconciliation records8 net6310 onOct4 with no fake refund,20 untouched and frozen original recovery facts', async () => {
  const db=fixture();const mappings=[];
  for(let i=1;i<=6;i++) {const advanceId=`reviewed-${i}`;mappings.push({advanceId,bikerId:`worker-${i}`});db.rows.set(`temporary_expenses/${advanceId}`,{biker_id:i===6?null:`worker-${i}`,title:`Synthetic advance${i}`,amount:i===6?200:90,status:'recovered',recovered_amount:0,spent_date:'2026-09-20',assignment_month:'2026-09',recovered_date:'2026-10-03'});}
  const before=structuredClone([...db.rows]);const unselected=before.filter(([path])=>/items\//.test(path)&&!ids.includes(path.split('/').at(-1)));
  const payload=request({payDate:'2026-10-04',recordedNetAmount:6310,reconciledAdvances:mappings});const p=await preview(db,payload);
  expect(p).toMatchObject({gross:6960,totals:{advances:650,net:6310},canRecord:true});expect(db.writes).toEqual([]);
  await expect(record(db,{...payload,previewHash:p.previewHash,recordedExternally:true})).rejects.toThrow(/أقر صراحة/);
  const result=await record(db,{...payload,previewHash:p.previewHash,recordedExternally:true,confirmAdvanceReconciliation:true});
  expect(result).toMatchObject({status:'partially_paid',payDate:'2026-10-04',totals:{advances:650,net:6310},selectedCount:8,remainingCount:20});
  expect(db.rows.get(`payroll_runs/${runId}`)).toMatchObject({ totals:{basic:24360,advances:650,net:23710}, originalSavedTotals:{net:24360}, paymentSummary:{paidNet:6310,remainingNet:17400} });
  for(const m of mappings){ const prior=before.find(([path])=>path===`temporary_expenses/${m.advanceId}`)[1]; const saved=db.rows.get(`temporary_expenses/${m.advanceId}`); for(const key of ['amount','biker_id','spent_date','assignment_month','status','recovered_amount','recovered_date'])expect(saved[key]).toEqual(prior[key]);expect(saved.payroll_reconciliation).toMatchObject({bikerId:m.bikerId,actualPayDate:'2026-10-04',confirmedBy:'admin'});}
  expect(unselected.every(([path,row])=>JSON.stringify(db.rows.get(path))===JSON.stringify(row))).toBe(true);
  const journal=db.rows.get(`journal_entries/${result.entryId}`);expect(journal.lines.find(row=>row.accountId==='1010')).toMatchObject({debit:0,credit:6310});expect(journal.lines.find(row=>row.accountId==='1300')).toMatchObject({debit:0,credit:650});
  const writes=db.writes.length;expect(await record(db,{...payload,previewHash:p.previewHash,recordedExternally:true,confirmAdvanceReconciliation:true})).toMatchObject({replay:true,entryId:result.entryId});expect(db.writes).toHaveLength(writes);
});
it.each([
  ['posted recovery lock',db=>db.rows.set('posting_locks/recovery__a',{entryId:'prior'})],
  ['posted refund journal',db=>db.rows.set('journal_entries/refund',{status:'posted',sourceType:'recovery',sourceId:'a'})],
  ['previous payroll recovery',db=>{db.rows.get('temporary_expenses/a').payroll_lock_id='prior';}],
  ['previous recovered amount',db=>{db.rows.get('temporary_expenses/a').recovered_amount=90;}],
  ['different linked worker',db=>{db.rows.get('temporary_expenses/a').biker_id='worker-28';}],
])('cannot offset a recovery with%s',async(_label,change)=>{const db=fixture();db.rows.set('temporary_expenses/a',{biker_id:'worker-1',amount:90,status:'recovered',recovered_amount:0,assignment_month:'2026-09',spent_date:'2026-09-20',recovered_date:'2026-10-03'});change(db);await expect(preview(db,request({recordedNetAmount:6870,reconciledAdvances:[{advanceId:'a',bikerId:'worker-1'}]}))).rejects.toThrow(/غير مؤهلة/);expect(db.writes).toEqual([]);});
it('owner can attest an unlinked group belongs to others, but cannot bypass linked or name-matched previous payment',async()=>{
  const db=fixture();db.rows.set('monthly_expenses/five',{expense_name:'رواتب خمسة عمال',payment_status:'مدفوع',logged_date:'2026-10-03',total_monthly_cost:4350});
  const payload=request({unrelatedLegacyPayments:['monthly_expenses/five']});const p=await preview(db,payload);expect(p).toMatchObject({canRecord:true,historicalPayments:[{confirmedUnrelated:true}]});
  await record(db,{...payload,previewHash:p.previewHash,recordedExternally:true});
  for(const extra of [{biker_id:'worker-1',expense_name:'Salary'}, {expense_name:'راتب Synthetic 1'}]) {const d=fixture();d.rows.set('monthly_expenses/five',{...extra,payment_status:'مدفوع',logged_date:'2026-10-03',total_monthly_cost:870});await expect(preview(d,payload)).rejects.toThrow(/لا يمكن استبعاد/);expect(d.writes).toEqual([]);}
});

it('a paid row inside a draft aggregate is frozen by generic preview/save/approve/cancel too',async()=>{
 const db=fixture();db.rows.get(`payroll_runs/${runId}/items/worker-1`).status='paid';db.rows.set('bikers/worker-1',{salary:-1});const before=structuredClone([...db.rows]);
 expect(await previewPayroll(db,{periodKey:'2026-09',automaticAdvanceDeduction:true},{now})).toMatchObject({status:'partially_paid',snapshotOnly:true});
 await expect(savePayrollDraft(db,FV,{periodKey:'2026-09'})).rejects.toThrow(/سدادًا سابقًا/);await expect(approvePayroll(db,FV,{runId})).rejects.toThrow(/سدادًا سابقًا/);await expect(cancelPayroll(db,FV,{runId,reason:'Test'})).rejects.toThrow(/سدادًا سابقًا/);
 expect([...db.rows]).toEqual(before);expect(db.writes).toEqual([]);
 db.rows.get(`payroll_runs/${runId}`).status='approved';await expect(unapprovePayroll(db,FV,{runId,reason:'Test'})).rejects.toThrow(/سدادًا سابقًا/);expect(db.writes).toEqual([]);
});
