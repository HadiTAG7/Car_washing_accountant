import { REVIEW_OWNER_UID, REVIEW_OWNER_EMAIL } from '../../src/lib/compensationReview.js';
export const owner = { uid: REVIEW_OWNER_UID, token: { email: REVIEW_OWNER_EMAIL } };
export const sourceActor = { uid: 'synthetic-agent', token: { email: 'agent@example.test' } };
export const testNow = new Date('2026-11-01T15:00:00+03:00');
export function reviewSource(ticketId = 'TEST-900001', patch = {}) {
  return { schemaVersion:1, ticketId, source:{url:'https://ssp-portal.sweater.sa/tickets/test',readAt:'2026-11-01T14:00:00+03:00',
    coverage:{from:'2026-10-25T00:00:00+03:00',to:'2026-11-01T14:00:00+03:00',complete:true,pages:['1 of 1 — synthetic'],
      filters:'Has Compensation = Yes; synthetic',limitations:['Synthetic evidence only'],lastCompleteThrough:'2026-11-01T14:00:00+03:00'}},
    facts:{washIds:['TEST-WASH'],biker:{name:'بايكر اختبار',externalId:'TEST-WORKER',siteId:null,linkEvidence:'Synthetic exact ID link'},
      createdAt:'2026-10-30 12:00',updatedAt:null,serviceDate:'2026-10-30',complaint:'شكوى اختبار اصطناعية',supportResponse:'رد دعم اختباري',comments:[]},
    amounts:[{kind:'compensation',value:25,unit:'SAR',sourceRef:'Synthetic compensation section'},
      {kind:'invoice_deduction',value:null,unit:'SAR',sourceRef:'Not found in synthetic invoice'},
      {kind:'late',value:10,unit:'minutes',sourceRef:'Synthetic timing'}],
    attachments:[{id:'TEST-IMAGE',kind:'image',url:'https://ssp-portal.sweater.sa/tickets/test',observation:'viewed',note:'Synthetic attachment placeholder; not a real customer image'}],
    timeline:[{label:'Creation Time',value:'2026-10-30 12:00',timezone:null,precision:'minute',sourceRef:'Synthetic detail'}],
    analysis:{proven:['دليل اصطناعي'],limitations:['لا يثبت عكس خصم'],objectionPoints:['نقطة اختبار'],proposedDraft:'مسودة اختبار غير مرسلة'},
    objections:[],queueDisposition:'eligible',historicalReference:null,...patch };
}
export const reviewSeed = () => ({
  ['users/'+REVIEW_OWNER_UID]:{role:'admin',email:REVIEW_OWNER_EMAIL},
  'users/synthetic-agent':{role:'admin',email:'agent@example.test'},'users/partner':{role:'partner'},
  'users/operator':{role:'operator'},'users/accountant':{role:'accountant'},
  'washes/untouched':{amount:20},'journal_entries/untouched':{posted:true},'payroll_runs/untouched':{status:'approved'},
});

