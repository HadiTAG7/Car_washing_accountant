import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/handlers.js';
import { normalizeRecord } from '../src/sweater/record.js';
import { previewOwnerHandoff, saveOwnerHandoff, OWNER_CONFIRMATIONS, OWNER_BOOKING_CLAIMS, sspWashId } from '../src/sweater/staffHandoff.js';
import { mapWash } from '../../src/lib/mappers.js';
import { summarizeOwnerWashes } from '../../src/lib/sweater/washSummary.js';
import { calculatePayrollPreview } from '../src/payroll.js';
import { washPostabilityProblem } from '../src/sweater/revenueOrigin.js';
import { reviewSweaterHandoff, ACCOUNT_BOOKINGS_SCOPE_WARNING } from '../../src/lib/sweater/handoff.js';

const payload = (extra = {}) => ({ importRunId: 'synthetic-owner-oct3',
  records: Array.from({ length: 7 }, (_, i) => ({ sspBookingId: `SYNTHETIC-${i + 1}`,
    serviceType: 'interior_exterior_wash', serviceDate: '2026-10-03',
    rawStatus: 'Collecting Payment', driverExternalId: i < 4 ? 'worker-a' : 'worker-b' })),
  coverage: { rangeFrom: '2026-10-03', rangeTo: '2026-10-03', extractedAt: '2026-10-04T12:00:00Z',
    pageCount: 1, pagesFetched: 1, recordCount: 7, isComplete: true },
  workerLinks: { 'worker-a': 'biker-a', 'worker-b': 'biker-b' },
  ownerConfirmation: { source: 'owner_statement', ownerName: 'Synthetic owner',
    statement: 'Synthetic confirmation of collection for these completed washes.', unitAmount: 20, totalAmount: 140, vatAmount: null },
  ...extra });
const FV = { serverTimestamp: () => 'synthetic-server-time' };
const scopedPayload = () => {
  const body = payload();
  body.coverage = { ...body.coverage, scope: 'accountBookings', scopeComplete: true,
    sourceRecordCount: 10, excludedCancelled: 3, imported: 7, isComplete: false };
  return body;
};

// Atomic, serialized local transaction model: failed transactions write zero
// documents; races see the committed state of the preceding transaction.
function dbFixture(role = 'accountant') {
  const rows = new Map([
    ['users/staff', { role }], ['bikers/biker-a', { name: 'Worker A', salary: 900, start_date: '2026-10-01' }],
    ['bikers/biker-b', { name: 'Worker B', salary: 1200, start_date: '2026-10-01' }],
  ]);
  const writes = [];
  const snapshot = path => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)), id: path.split('/').at(-1) });
  const ref = path => ({ path, get: async () => snapshot(path) });
  let queue = Promise.resolve();
  const db = { rows, writes,
    collection: name => ({ get: async () => ({ docs: [...rows.keys()].filter(path => path.startsWith(`${name}/`) && !path.slice(name.length + 1).includes('/')).map(snapshot) }), doc: id => ref(`${name}/${id}`), where: (field, _op, value) => ({
      get: async () => ({ docs: [...rows.keys()].filter(path => path.startsWith(`${name}/`) && rows.get(path)[field] === value).map(snapshot) }),
    }) }),
    runTransaction: callback => {
      const run = queue.then(async () => {
        const pending = [];
        const result = await callback({ get: reference => reference.get(), set: (reference, value, options) => pending.push([reference.path, value, options]) });
        for (const [path, value, options] of pending) {
          rows.set(path, options?.merge ? { ...rows.get(path), ...structuredClone(value) } : structuredClone(value));
          writes.push(path);
        }
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
  return db;
}
const request = (body, preview) => ({ payload: body, reviewedPayloadHash: preview.reviewedPayloadHash, previewStateHash: preview.previewStateHash });
async function save(db, body = payload()) { const preview = await previewOwnerHandoff(db, body); return saveOwnerHandoff(db, FV, request(body, preview), 'staff'); }

describe('owner confirmation is independent, atomic and idempotent', () => {
  it('imports only a verified account scope while preserving the company gap through preview, save and replay', async () => {
    const db = dbFixture(); const body = scopedPayload();
    const review = reviewSweaterHandoff(body);
    expect(review.ready).toBe(true); expect(review.warnings).toContain(ACCOUNT_BOOKINGS_SCOPE_WARNING);
    const preview = await previewOwnerHandoff(db, body);
    expect(preview).toMatchObject({ canSave: true, counts: { new: 7 }, coverage: body.coverage });
    expect(preview.reviewWarnings).toContain(ACCOUNT_BOOKINGS_SCOPE_WARNING); expect(db.writes).toEqual([]);
    const result = await saveOwnerHandoff(db, FV, request(body, preview), 'staff');
    expect(result).toMatchObject({ saved: true, coverage: { isComplete: false, scopeComplete: true }, ledgerPosted: false, payrollPaid: false });
    expect(db.rows.get(`sweater_import_runs/${body.importRunId}`)).toMatchObject({ status: 'completed_with_gaps', coverage: body.coverage });
    expect(db.rows.get('sweater_integration_state/current').lastCoverage).toEqual(body.coverage);
    const writes = db.writes.length;
    const replay = await saveOwnerHandoff(db, FV, request(body, preview), 'staff');
    expect(replay).toMatchObject({ replay: true, coverage: { isComplete: false } });
    expect(replay.reviewWarnings).toContain(ACCOUNT_BOOKINGS_SCOPE_WARNING); expect(db.writes.length).toBe(writes);
    const next = { ...body, importRunId: 'another-scoped-run' };
    const repeated = await previewOwnerHandoff(db, next);
    expect(repeated.counts).toMatchObject({ new: 0, duplicate: 7 });
    await saveOwnerHandoff(db, FV, request(next, repeated), 'staff');
    expect([...db.rows.keys()].filter(key => key.startsWith('washes/'))).toHaveLength(7);
    expect(db.writes.slice(writes).every(key => key.startsWith('sweater_import_runs/') || key.startsWith('sweater_integration_state/'))).toBe(true);
  });
  it.each([
    ['source count mismatch', body => { body.coverage.sourceRecordCount = 11; }],
    ['import count mismatch', body => { body.coverage.imported = 6; }],
    ['negative cancelled count', body => { body.coverage.excludedCancelled = -3; }],
    ['string count', body => { body.coverage.sourceRecordCount = '10'; }],
    ['missing source count', body => { delete body.coverage.sourceRecordCount; }],
    ['missing page', body => { body.coverage.pageCount = 2; }],
    ['no page', body => { body.coverage.pageCount = 0; body.coverage.pagesFetched = 0; }],
    ['unknown scope', body => { body.coverage.scope = 'company'; }],
    ['missing scope', body => { delete body.coverage.scope; }],
    ['incomplete scope', body => { body.coverage.scopeComplete = false; }],
    ['untyped scope completeness', body => { body.coverage.scopeComplete = 'true'; }],
    ['false global completeness claim', body => { body.coverage.isComplete = true; }],
    ['duplicate source booking', body => { body.records[1].sspBookingId = body.records[0].sspBookingId; }],
  ])('rejects %s before database reads or writes', async (_name, mutate) => {
    const body = scopedPayload(); mutate(body);
    const db = { collection: () => { throw new Error('must not read'); }, runTransaction: () => { throw new Error('must not transact'); } };
    await expect(previewOwnerHandoff(db, body)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(saveOwnerHandoff(db, FV, { payload: body }, 'staff')).rejects.toMatchObject({ code: 'invalid-argument' });
  });
  it.each(['Collecting Payment', 'CollectingPayment', 'payment_collection'])('supports %s without claiming platform payment', status => {
    const record = normalizeRecord({ ...payload().records[0], rawStatus: status });
    expect(record.rawStatus).toBe(status); expect(record.normalizedStatus).toBe('payment_collection');
    expect(record.paymentStatus).toBe('unknown'); expect(record.completedAt).toBeNull();
  });
  it('previews read only then saves seven unique washes, separate evidence and no financial writes', async () => {
    const db = dbFixture(); const body = payload(); const original = structuredClone(body);
    const preview = await previewOwnerHandoff(db, body);
    expect(db.writes).toEqual([]); expect(preview).toMatchObject({ canSave: true, counts: { new: 7 } });
    const result = await saveOwnerHandoff(db, FV, request(body, preview), 'staff');
    expect(result).toMatchObject({ saved: true, dryRun: false, ledgerPosted: false, payrollPaid: false });
    expect(new Set(result.washIds).size).toBe(7);
    for (const id of result.bookingIds) {
      const booking = db.rows.get(`sweater_bookings/${id}`);
      expect(booking.record).toMatchObject({ rawStatus: 'Collecting Payment', paymentStatus: 'unknown', platformAmount: null });
      expect(db.rows.get(`${OWNER_CONFIRMATIONS}/${id}`)).toMatchObject({ collectionStatus: 'confirmed_by_owner', assertedAmount: 20, vatAmount: null, paymentMethod: null, bankAccountId: null, recordedBy: 'staff' });
      const wash = db.rows.get(`washes/${sspWashId(id)}`);
      expect(wash).toMatchObject({ quantity: 1, price: 20, status: 'مكتملة', revenue_origin: 'sweater', payment_method: null, worker_commission_paid: false });
      expect(washPostabilityProblem(wash)).toBeTruthy();
      expect(mapWash({ id: sspWashId(id), ...wash }).paymentMethod).toBeNull();
    }
    expect(db.writes.every(path => /^(washes|sweater_)/.test(path))).toBe(true);
    expect(body).toEqual(original);
    const grouped = summarizeOwnerWashes(result.washIds.map(id => mapWash({ id, ...db.rows.get(`washes/${id}`) })));
    expect(grouped.map(group => [group.quantity, group.totalAmount, group.commission])).toEqual([[4, 80, 18], [3, 60, 13.5]]);
  });
  it('same run retry and competing saves write only once; different run cannot duplicate washes/evidence', async () => {
    const db = dbFixture(); const body = payload(); const preview = await previewOwnerHandoff(db, body); const req = request(body, preview);
    const results = await Promise.all([saveOwnerHandoff(db, FV, req, 'staff'), saveOwnerHandoff(db, FV, req, 'staff')]);
    expect(results.map(result => result.replay)).toEqual([false, true]);
    const writes = db.writes.length;
    expect((await saveOwnerHandoff(db, FV, req, 'staff')).replay).toBe(true); expect(db.writes.length).toBe(writes);
    const next = { ...body, importRunId: 'different-run' }; await save(db, next);
    expect([...db.rows.keys()].filter(path => path.startsWith('washes/'))).toHaveLength(7);
    expect([...db.rows.keys()].filter(path => path.startsWith(`${OWNER_CONFIRMATIONS}/`))).toHaveLength(7);
    expect(db.writes.slice(writes).every(path => path.startsWith('sweater_import_runs/') || path.startsWith('sweater_integration_state/'))).toBe(true);
  });
  it('rejects reused run with altered owner evidence even though the source records match', async () => {
    const db = dbFixture(); await save(db);
    const body = payload(); body.ownerConfirmation.statement = 'Changed statement';
    await expect(previewOwnerHandoff(db, body)).rejects.toMatchObject({ code: 'already-exists' });
  });
  it('stale preview, linked legacy wash, altered wash or conflicting evidence cannot overwrite sources', async () => {
    const db = dbFixture(); const body = payload(); const preview = await previewOwnerHandoff(db, body);
    db.rows.set('washes/legacy-wash', { ssp_booking_id: body.records[0].sspBookingId });
    await expect(saveOwnerHandoff(db, FV, request(body, preview), 'staff')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(db.writes).toEqual([]);
    db.rows.delete('washes/legacy-wash'); db.rows.get('bikers/biker-a').name = 'Changed worker';
    await expect(saveOwnerHandoff(db, FV, request(body, preview), 'staff')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(db.writes).toEqual([]);
    await save(db);
    db.rows.get(`washes/${sspWashId(body.records[0].sspBookingId)}`).price = 99;
    expect((await previewOwnerHandoff(db, { ...body, importRunId: 'altered-source' })).canSave).toBe(false);
  });
  it.each(['operator', 'partner', 'integration_ingest'])('refuses %s with no writes and no new permission', async role => {
    const db = dbFixture(role); const body = payload(); const preview = await previewOwnerHandoff(db, body);
    await expect(dispatch(db, FV, 'sweaterSaveOwnerHandoff', request(body, preview), { uid: 'staff' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.writes).toEqual([]);
  });
  it.each(['admin', 'accountant'])('saves using existing %s session and server actor', async role => {
    const db = dbFixture(role); const body = payload(); const preview = await previewOwnerHandoff(db, body);
    expect((await dispatch(db, FV, 'sweaterSaveOwnerHandoff', request(body, preview), { uid: 'staff' })).saved).toBe(true);
  });
  it('blocks cancelled/pending bookings, duplicates, incomplete source, unknown worker and invented VAT/bank', async () => {
    for (const mutate of [
      body => { body.records[0].rawStatus = 'admin_cancelled'; },
      body => { body.records[0].rawStatus = 'Initiated'; },
      body => { body.records[1].sspBookingId = body.records[0].sspBookingId; },
      body => { body.coverage.isComplete = false; },
      body => { delete body.workerLinks; },
      body => { body.ownerConfirmation.vatAmount = 0; },
      body => { body.ownerConfirmation.bankAccountId = 'invented-bank'; },
      body => { body.ownerConfirmation.totalAmount = 139; },
    ]) {
      const db = dbFixture(); const body = payload(); mutate(body);
      await expect(previewOwnerHandoff(db, body)).rejects.toMatchObject({ code: 'invalid-argument' }); expect(db.writes).toEqual([]);
    }
    const db = dbFixture(); db.rows.delete('bikers/biker-a');
    expect((await previewOwnerHandoff(db, payload())).canSave).toBe(false);
  });
  it('new October payroll counts each saved wash once at 4.50 and preserves each stored salary', async () => {
    const db = dbFixture(); const result = await save(db);
    const preview = calculatePayrollPreview({ periodKey: '2026-10',
      bikers: [...db.rows.entries()].filter(([key]) => key.startsWith('bikers/')).map(([key, row]) => ({ id: key.split('/')[1], ...row })),
      washes: result.washIds.map(id => ({ id, ...db.rows.get(`washes/${id}`) })) });
    expect(preview.lines.map(line => line.commission)).toEqual([18, 13.5]);
    expect(preview.totals.commissions).toBe(31.5);
    expect(preview.lines.map(line => line.monthlySalary)).toEqual([900, 1200]);
    expect(db.writes.some(path => path.startsWith('payroll'))).toBe(false);
  });
});

const taxedPayload = () => {
  const body=payload();body.importRunId='synthetic-owner-tax-oct5';
  body.records=Array.from({length:4},(_,i)=>({sspBookingId:`S-${920001+i}`,serviceDate:'2026-10-05',rawStatus:'CollectingPayment',rawPaymentStatus:'Pending',driverExternalId:'worker-a'}));
  body.workerLinks={'worker-a':'biker-a'};
  body.coverage={rangeFrom:'2026-10-05',rangeTo:'2026-10-05',extractedAt:'2026-10-05T12:00:00Z',pageCount:1,pagesFetched:1,recordCount:4,isComplete:false,scope:'accountBookings',scopeComplete:true,sourceRecordCount:5,excludedCancelled:1,imported:4};
  body.ownerConfirmation={source:'owner_statement',ownerName:'Synthetic owner',statement:'Owner explicitly asserts net20 VAT3 gross23 for each of these4 washes; service type not visible.',unitAmount:20,totalAmount:80,vatAmount:3,priceMode:'exclusive',grossAmount:23,totalVatAmount:12,totalGrossAmount:92};return body;
};
describe('explicit owner VAT contract and numeric booking claims',()=>{
  it('previews80/12/92 and saves4 operational washes without inventing service, platform payment, bank, payroll or ledger',async()=>{
    const db=dbFixture();
    for(let i=0;i<12;i++)db.rows.set(`washes/old-${i}`,{ssp_booking_id:`S-${910000+i}`,price:20,vat_amount:3,net_amount:20,gross_amount:23,owner_tax_snapshot:{historical:true}});
    db.rows.set('bank_accounts/protected',{balance:999});db.rows.set('journal_entries/protected',{entryNumber:163,status:'posted'});
    const protectedRows=structuredClone([...db.rows]);const body=taxedPayload();const before=structuredClone(body);
    const local=reviewSweaterHandoff(body);expect(local.ready).toBe(true);expect(local.warnings.some(x=>x.includes('نوع الخدمة غير مثبت'))).toBe(true);
    const p=await previewOwnerHandoff(db,body);expect(p).toMatchObject({canSave:true,counts:{new:4},ownerConfirmation:{totalAmount:80,totalVatAmount:12,totalGrossAmount:92}});expect(db.writes).toEqual([]);
    for(const row of p.rows)expect(row).toMatchObject({netAmount:20,vatAmount:3,grossAmount:23,workerCommission:4.5,rawStatus:'CollectingPayment',paymentStatus:'pending'});
    const result=await saveOwnerHandoff(db,FV,request(body,p),'staff');expect(result).toMatchObject({ledgerPosted:false,payrollPaid:false,saved:true});
    for(const id of result.bookingIds){
      const record=db.rows.get(`sweater_bookings/${id}`).record;expect(record).toMatchObject({serviceType:'',bookingKind:'unknown',rawStatus:'CollectingPayment',rawPaymentStatus:'Pending',paymentStatus:'pending',platformAmount:null});
      const wash=db.rows.get(`washes/${sspWashId(id)}`);expect(wash).toMatchObject({price:20,net_amount:20,vat_amount:3,gross_amount:23,price_mode:'exclusive',vat_rate:0.15,worker_commission_per_wash:4.5,worker_commission_paid:false,payment_method:null,collection_status:'confirmed_by_owner'});
      expect(washPostabilityProblem(wash)).toBeTruthy();
      expect(mapWash({id:sspWashId(id),...wash}).ownerTaxSnapshot).toMatchObject({net:20,vat:3,gross:23,source:'owner_statement'});
      expect(db.rows.get(`${OWNER_CONFIRMATIONS}/${id}`)).toMatchObject({assertedAmount:20,vatAmount:3,taxSplit:{net:20,vat:3,gross:23},paymentMethod:null,bankAccountId:null});
    }
    expect(protectedRows.every(([path,row])=>JSON.stringify(db.rows.get(path))===JSON.stringify(row))).toBe(true);
    const washes=result.washIds.map(id=>({id,...db.rows.get(`washes/${id}`)}));
    const payroll=calculatePayrollPreview({periodKey:'2026-10',bikers:[{id:'biker-a',salary:900}],washes});expect(payroll.totals.commissions).toBe(18);
    expect(db.writes.every(path=>/^(washes|sweater_)/.test(path))).toBe(true);expect(body).toEqual(before);
  });
  it.each([
    ['missing gross',b=>{delete b.ownerConfirmation.grossAmount;}],['wrong unit gross',b=>{b.ownerConfirmation.grossAmount=24;}],
    ['wrong VAT total',b=>{b.ownerConfirmation.totalVatAmount=11;}],['wrong gross total',b=>{b.ownerConfirmation.totalGrossAmount=91;}],
    ['negative VAT',b=>{b.ownerConfirmation.vatAmount=-3;}],['string VAT',b=>{b.ownerConfirmation.vatAmount='3';}],
    ['fractional cent',b=>{b.ownerConfirmation.vatAmount=3.001;}],['missing price mode',b=>{delete b.ownerConfirmation.priceMode;}],
    ['null with asserted split',b=>{b.ownerConfirmation.vatAmount=null;}],['prefix collision in batch',b=>{b.records[1].sspBookingId='C-920001';}],
    ['cancelled booking',b=>{b.records[0].rawStatus='Cancelled';}],
  ])('rejects%s before writes',async(_label,mutate)=>{const db=dbFixture();const b=taxedPayload();mutate(b);await expect(previewOwnerHandoff(db,b)).rejects.toMatchObject({code:'invalid-argument'});expect(db.writes).toEqual([]);});
  it('blocks prefix variants already present in the12 legacy washes, orphan evidence, bookings and financial links',async()=>{
    for(const [collection,data] of [['washes',{ssp_booking_id:'C-920001'}],['sweater_bookings',{sspBookingId:'C-920001'}],[OWNER_CONFIRMATIONS,{sspBookingId:'C-920001'}],['sweater_booking_links',{sspBookingId:'C-920001'}]]){
      const db=dbFixture();db.rows.set(`${collection}/legacy`,data);const b=taxedPayload();const p=await previewOwnerHandoff(db,b);
      expect(p.canSave).toBe(false);expect(p.rows[0]).toMatchObject({reasonCode:'booking_number_conflict'});
      await expect(saveOwnerHandoff(db,FV,request(b,p),'staff')).rejects.toMatchObject({code:'failed-precondition'});expect(db.writes).toEqual([]);
    }
  });
  it('claims the primary booking number atomically against competing prefixes and never creates a second wash',async()=>{
    const db=dbFixture();const a=taxedPayload();const b=structuredClone(a);b.importRunId='synthetic-prefix-race';b.records[0].sspBookingId='C-920001';
    const [pa,pb]=await Promise.all([previewOwnerHandoff(db,a),previewOwnerHandoff(db,b)]);
    const results=await Promise.allSettled([saveOwnerHandoff(db,FV,request(a,pa),'staff'),saveOwnerHandoff(db,FV,request(b,pb),'staff')]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.find(x=>x.status==='rejected').reason.code).toBe('failed-precondition');
    expect([...db.rows.keys()].filter(path=>path.startsWith('washes/'))).toHaveLength(4);
    expect(db.rows.get(`${OWNER_BOOKING_CLAIMS}/920001`)).toMatchObject({sspBookingId:'S-920001',washId:'ssp__S-920001'});
  });
  it('a lost save response is recovered with the same batch and fresh preview, without any second write or commission',async()=>{
    const db=dbFixture();const b=taxedPayload();const p=await previewOwnerHandoff(db,b);
    await expect((async()=>{await saveOwnerHandoff(db,FV,request(b,p),'staff');throw new Error('synthetic response lost');})()).rejects.toThrow('response lost');
    const writes=db.writes.length;const again=await previewOwnerHandoff(db,b);expect(again).toMatchObject({previousRun:{sameRecords:true},counts:{duplicate:4}});
    expect(await saveOwnerHandoff(db,FV,request(b,again),'staff')).toMatchObject({saved:true,replay:true});expect(db.writes).toHaveLength(writes);
    const other={...b,importRunId:'synthetic-same-tax-new-run'};const duplicate=await previewOwnerHandoff(db,other);expect(duplicate.counts.duplicate).toBe(4);
    await saveOwnerHandoff(db,FV,request(other,duplicate),'staff');expect([...db.rows.keys()].filter(path=>path.startsWith('washes/'))).toHaveLength(4);
  });
});
