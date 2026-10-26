import { previewPayrollMonths } from '../functions/src/payroll.js';
import { mapBiker, mapWash } from '../src/lib/mappers.js';
import { overviewOperations } from '../src/lib/overviewDashboard.js';
import { idleBikers } from '../src/lib/idleBikers.js';
import { operationsToday } from '../src/lib/operationsToday.js';
import { composeSweaterMetricReadings } from '../src/lib/sweaterMetricReadings.js';
import { OPERATIONS_NUMBER_ROWS, operationsSnapshotSchema } from '../src/lib/operationsReportPublication.js';

/** Same stored-data engines as the overview, idle tab and Today. This adapter
 * exposes reads only; it never calls SSP, sync, payroll approval or posting. */
export async function captureReportOperations(db,requestedCutAt,now=new Date()){
  const capturedAt=new Date(now.getTime()+10800000).toISOString().replace('Z','+03:00');
  const day=capturedAt.slice(0,10),month=day.slice(0,7),cache=new Map();
  const metrics=OPERATIONS_NUMBER_ROWS.map(r=>({id:r.id,value:null,basis:'unavailable',coverage:'تعذرت قراءة المصدر وقت الحفظ؛ لم يُفترض صفر.'}));
  const set=(id,value,coverage)=>{if(Number.isFinite(value))Object.assign(metrics.find(m=>m.id===id),{value,basis:'operational',coverage});};
  const rows=name=>{if(!cache.has(name))cache.set(name,db.collection(name).get().then(s=>s.docs.map(d=>({...d.data(),id:d.id}))));return cache.get(name);};
  const washes=rows('washes').then(rs=>rs.map(r=>({...mapWash(r),status:r.status,quantity:Math.max(0,Number(r.quantity)||0)})));
  const bikers=rows('bikers').then(rs=>rs.map(mapBiker));
  const snapshot=rows('sweater_metric_snapshots').then(rs=>composeSweaterMetricReadings(rs.filter(r=>Date.parse(r.extractedAtIso)<=now.getTime()),month));
  const counts=Promise.all([washes,bikers]).then(([w,b])=>{
    const ops=overviewOperations({washes:w,bikers:b,periodKey:month,today:day});
    if(!ops||ops.conflicts.length)throw Error('conflicting washes');
    const previous=ops.yesterdayInPeriod?ops:overviewOperations({washes:w,bikers:b,periodKey:ops.yesterday.slice(0,7),today:day});
    set('yesterday-washes',previous?.yesterdayQuantity,`النظرة العامة · ${ops.yesterday}؛ الغسلات المكتملة المسجلة.`);
    set('month-washes',ops.quantity,`النظرة العامة · ${month} حتى قراءة ${day}؛ حسب السجل المتاح.`);
    set('working-bikers',ops.working,`نفس تعريف النظرة العامة: بايكرية لهم غسلات مكتملة مسجلة في ${month}.`);
  });
  const idle=Promise.all([washes,bikers,previewPayrollMonths(db,[month],{now})]).then(([w,b,p])=>{
    if(!p[0]||p[0].error||!Array.isArray(p[0].lines))throw Object.assign(Error('payroll unavailable'),{code:p[0]?.error?.code});
    const result=idleBikers({bikers:b,washes:w,payrollLines:p[0].lines,periodKey:month,today:day,historyComplete:true});
    if(result.error)throw Error('idle unavailable');
    set('idle-bikers',result.count,`تبويب الخاملين · ${month}؛ أيام مكتملة، دون الهاربين أو من له تاريخ نهاية.`);
  });
  const cancellations=snapshot.then(s=>set('biker-cancellations',s?.metrics?.cancelledByBiker,`لقطة سويتر المحفوظة · ${month}؛ وقت المصدر ${s?.metricSources?.cancelledByBiker?.extractedAtIso||'غير متاح'}.`));
  const reconciliation=Promise.all([washes,bikers,rows('sweater_bookings'),snapshot]).then(([w,b,bookings,s])=>{
    const result=operationsToday({day,today:day,washes:w,bikers:b,bookings,snapshot:s});
    if(result.error||result.bookingsConflict)throw Error('reconciliation unavailable');
    set('sweater-difference',result.reconciliation?.difference,`صفحة اليوم: سويتر ناقص المسجل عند نفس القطع؛ ${result.reconciliation?.extractedAt||'القطع غير متاح'}.`);
  });
  const results=await Promise.allSettled([counts,idle,cancellations,reconciliation]);
  const fatal=results.find(r=>r.status==='rejected'&&/^[0-9A-Z]{5}$/.test(String(r.reason?.code||'')));
  if(fatal)throw fatal.reason;
  return operationsSnapshotSchema.parse({version:1,source:'site-functions',requestedCutAt,capturedAt,day,month,metrics});
}
