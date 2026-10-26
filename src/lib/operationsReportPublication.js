import { z } from 'zod';
export const OPERATIONS_NUMBER_ROWS = Object.freeze([
  {id:'yesterday-washes',label:'غسلات أمس'}, {id:'month-washes',label:'غسلات الشهر'},
  {id:'working-bikers',label:'البايكرية الشغالون'}, {id:'idle-bikers',label:'البايكرية الخاملون'},
  {id:'sweater-difference',label:'فرق عدد سويتر'}, {id:'biker-cancellations',label:'إلغاءات البايكر'},
]);
export const operationsSnapshotSchema=z.object({version:z.literal(1),source:z.literal('site-functions'),
  requestedCutAt:z.string().datetime({offset:true}).nullable(),capturedAt:z.string().datetime({offset:true}),
  day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),month:z.string().regex(/^\d{4}-\d{2}$/),
  metrics:z.array(z.object({id:z.enum(OPERATIONS_NUMBER_ROWS.map(r=>r.id)),value:z.number().finite().nullable(),
    basis:z.enum(['operational','unavailable']),coverage:z.string().min(1).max(500)}).strict()).length(6),
}).strict().refine(s=>new Set(s.metrics.map(m=>m.id)).size===6&&s.day===s.capturedAt.slice(0,10)&&s.month===s.day.slice(0,7)
  &&(!s.requestedCutAt||Date.parse(s.capturedAt)>=Date.parse(s.requestedCutAt))
  &&s.metrics.every(m=>(m.value===null)===(m.basis==='unavailable')),'لقطة أرقام العمليات غير مكتملة.');
export function operationsSubmission(report){const {operationsSnapshot:_snapshot,...submission}=report;return submission;}
export const sameOperationsSubmission=(a,b)=>JSON.stringify(operationsSubmission(a))===JSON.stringify(operationsSubmission(b));
