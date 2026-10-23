import { describe, it, expect } from 'vitest';
import { buildVatDashboardReport, declarationDeadline, daysToDeadline, registeredPeriods, riyadhDay, invoiceFollowUp } from '../vatDashboard';

const policy = () => ({ known: true, vatRegistered: true, washPriceMode: 'exclusive', vatRate: .15 });
const wash = { id:'w',status:'مكتملة',quantity:1,price:20,washDate:'2026-10-20',revenueOrigin:'sweater' };
const invoice = { id:'i',source:'variable',sourceKind:'variable',isTaxInvoice:true,amount:115,priceMode:'inclusive',invoiceDate:'2026-10-01',invoiceNumber:'INV',supplier:'مورد',vatAmount:15 };
const opts = { inputs:[invoice], washes:[wash], entries:[], lines:[], period:'2026-Q4',filing:'quarterly',policyAt:policy };
describe('VAT declaration deadlines', () => {
  it.each([['2026-Q1','2026-04-30'],['2026-Q2','2026-07-31'],['2026-Q3','2026-10-31'],['2026-Q4','2027-01-31'],['2028-01','2028-02-29'],['2026-01','2026-02-28']])('%s → %s', (p,date) => expect(declarationDeadline(p)).toBe(date));
  it.each(['','2026-Q5','2026-13','2026-00','2026-Q3anything'])('rejects %s', p => expect(declarationDeadline(p)).toBeNull());
  it('uses calendar days and Riyadh midnight, not browser timezone', () => {
    expect(riyadhDay(new Date('2026-10-23T21:01:00Z'))).toBe('2026-10-24');
    expect(daysToDeadline('2026-10-31','2026-10-23')).toBe(8);
    expect(daysToDeadline('2026-07-31','2026-10-23')).toBe(-84);
  });
  it('does not invent a registration date from the current checkbox', () => {
    expect(registeredPeriods({vatRegistered:true},'2026-10-23')).toEqual([]);
    expect(registeredPeriods({taxPolicyHistory:[{effectiveFrom:'2026-05-01',vatRegistered:true}]},'2026-10-23')).toEqual(['2026-Q2','2026-Q3','2026-Q4']);
  });
});
describe('VAT dashboard basis, not a ledger rewrite', () => {
  it('keeps operational output and posted comparison even when ledger is nil', () => {
    const r=buildVatDashboardReport({...opts,entries:[{id:'j',status:'posted',entryDate:'2026-10-20'}],lines:[{entryId:'j',accountId:'2100',debit:0,credit:0}]});
    expect(r.output.tax).toBe(3); expect(r.ledgerOutput.tax).toBe(0); expect(r.netTax).toBe(-12); expect(r.outputMismatch).toBe(3);
  });
  it('uses an approved SSP month once and preserves direct sales', () => {
    const r=buildVatDashboardReport({...opts,washes:[wash,{...wash,id:'direct',revenueOrigin:'direct'}],settlements:[{periodKey:'2026-10',status:'approved',figures:{services:{net:100,vat:15,gross:115,count:5}}}]});
    expect(r.output.tax).toBe(18); expect(r.output.count).toBe(6);
  });
  it('does not use an unapproved settlement or a settlement outside the period', () => {
    const r=buildVatDashboardReport({...opts,settlements:[{periodKey:'2026-10',status:'calculated',figures:{services:{net:100,vat:15,gross:115}}},{periodKey:'2026-09',status:'approved',figures:{services:{net:100,vat:15,gross:115}}}]});
    expect(r.output.tax).toBe(3);
  });
  it('flags missing figures on an approved settlement instead of double counting', () => {
    const r=buildVatDashboardReport({...opts,settlements:[{periodKey:'2026-10',status:'approved'}]});
    expect(r.invalidSettlements).toBe(1); expect(r.policyUnconfigured).toBe(true);
  });
  it('retains a frozen purchase snapshot under a later changed policy', () => {
    const r=buildVatDashboardReport({...opts,policyAt:()=>({known:true,vatRegistered:false}),entries:[{id:'e',status:'posted',sourceKind:'variable',sourceId:'i',purchaseTaxSnapshot:{net:100,vat:15,gross:115,deductible:true,invoiceDate:'2026-10-01'}}]});
    expect(r.input.tax).toBe(15);
  });
  it('period-filters non-tax receipts and keeps truly undated records outside headline cards', () => {
    const r=buildVatDashboardReport({...opts,inputs:[{...invoice,id:'prev',invoiceDate:'2026-09-01',isTaxInvoice:false},{...invoice,id:'this',isTaxInvoice:false},{...invoice,id:'unknown',isTaxInvoice:false,invoiceDate:''}]});
    expect(r.ineligible.map(x=>x.id)).toEqual(['this']); expect(r.undated.map(x=>x.id)).toEqual(['unknown']); expect(r.input.tax).toBe(0);
  });
  it('does not infer unrecorded VAT from non-tax receipt totals', () => {
    const r=invoiceFollowUp({ineligible:[{sourceKey:'a',supplier:'A',amount:115,isTaxInvoice:false,documentVat:0,vatAmount:null,missing:['فاتورة غير ضريبية','اسم']},{sourceKey:'b',supplier:'A',amount:230,isTaxInvoice:true,documentVat:30,vatAmount:30,missing:['اسم']}]});
    expect(r.suppliers).toEqual([{supplier:'A',count:2,tax:30,unknownTax:1}]); expect(r.reasons.find(x=>x.reason==='اسم').count).toBe(2);
  });
});
