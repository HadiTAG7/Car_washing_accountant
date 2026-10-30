import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { assertFinanceApproval } from '../../functions/src/financeReview.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { allocationSources, evidenceSeed, evidenceCall, linkAllocation, approveEvidence, saveEvidence } from './financeSourceEvidenceFixtures.js';

function seed() {
  const rows=evidenceSeed(); rows['chart_of_accounts/2300']={};
  for(const id of allocationSources) Object.assign(rows['startup_cost_entries/'+id],{
    spent_date:'2026-09-20',invoice_date:'2026-09-20',payment_method:'founding_personal',payment_status:'paid',paid_date:'2026-09-20',
    finance_metadata:{...rows['startup_cost_entries/'+id].finance_metadata,fundingType:'owner_current',fundingReference:'TEST actual owner funding'}
  });
  return memoryFinanceDb(rows);
}
function posted(db,id,n) {
  const amount=db.rows.get('startup_cost_entries/'+id).amount;
  db.rows.set('journal_entries/TEST-'+id,{sourceId:id,sourceKind:'startup',sourceType:'expense',status:'posted',
    entryNumber:n,entryDate:'2026-09-20',lines:[{accountId:'1500',debit:amount,credit:0},{accountId:'2300',debit:0,credit:amount}]});
}
const orders=[allocationSources,[...allocationSources].reverse()];
describe('posted source approval-context display',()=>{
 it.each(orders.map(order=>[order]))('keeps both approvals current in either order when no allocated source changes: %j',async order=>{
   const db=seed();await linkAllocation(db);
   for(const id of order) await approveEvidence(db,id);
   order.forEach((id,i)=>posted(db,id,9000+i));
   for(const id of order) {
     const d=await evidenceCall(db,{action:'read',sourceId:id});
     expect(d.approved).toBe(true);expect(d.workflowStage).toBe('complete');
     await expect(assertFinanceApproval(db,{get:ref=>ref.get()},'startup',id,d.row)).rejects.toThrow(/قيد سابق/);
   }
 });
 it.each(orders.map(order=>[order]))('shows a posted approval review after either peer changes quantity, without changing any source or journal: %j',async ([first,peer])=>{
   const db=seed();await linkAllocation(db);await approveEvidence(db,first);posted(db,first,9001);
   const initial=await evidenceCall(db,{action:'read',sourceId:first});expect(initial.approved).toBe(true);
   const originalRow=structuredClone(initial.row), originalReview=structuredClone(initial.review);
   await saveEvidence(db,peer,{quantity:3});await approveEvidence(db,peer);posted(db,peer,9002);
   const before=structuredClone([...db.rows]), stale=await evidenceCall(db,{action:'read',sourceId:first});
   expect(stale.sourceHash).toBe(initial.sourceHash);expect(stale.review).toEqual(originalReview);expect(stale.row).toEqual(originalRow);
   expect(stale.approved).toBe(false);expect(stale.protectedSource).toBe(true);
   expect(stale.approvalReady).toBe(false);expect(stale.postingReady).toBe(false);
   expect(stale.workflowStage).toBe('posted_review');
   expect(stale.workflowNote).toContain('تغيّرت نسخة أحد جزأي المستند');
   expect(stale.workflowDimensions.approval).toMatchObject({current:false,contextMatches:false});
   expect(stale.workflowDimensions.posting.status).toBe('posted');expect(stale.paymentProven).toBe(true);
   const browse=await financeWorkbench(db,{uid:'test-admin'},{action:'browse'});
   expect(browse.items.find(x=>x.sourceId===first).workflowStage).toBe('posted_review');
   const other=await evidenceCall(db,{action:'read',sourceId:peer});expect(other.approved).toBe(true);expect(other.workflowStage).toBe('complete');
   expect([...db.rows]).toEqual(before);
   await expect(assertFinanceApproval(db,{get:ref=>ref.get()},'startup',first,stale.row)).rejects.toThrow(/توزيع الأصل/);
 });
});

