import {financeHash} from '../../functions/src/financeReview.js';
import {PAYROLL_CASH_FUNDING} from '../payrollCashFundingPolicy.js';
export const fundingAuth={uid:'funding-admin'};
export const fundingSources=PAYROLL_CASH_FUNDING.sources.map((s,i)=>({...s,journalId:`synthetic-payroll-${i}`,originalJournalSha256:'synthetic'}));
export function fundingSeed(){
  const seed={
    'users/funding-admin':{role:'admin'},'users/other-admin':{role:'admin'},
    'chart_of_accounts/1010':{code:'1010',accountType:'asset',active:true},'chart_of_accounts/1020':{code:'1020',accountType:'asset',active:true},
    'chart_of_accounts/5010':{code:'5010',accountType:'expense',active:true},'chart_of_accounts/3000':{code:'3000',accountType:'equity',active:true},
    'accounting_periods/2026-10':{periodKey:'2026-10',status:'open'},'counters/journal':{nextNumber:169},
    'payroll_runs/2026-08__r1':{periodKey:'2026-08',status:'paid'},'payroll_runs/2026-09__r1':{periodKey:'2026-09',status:'paid'},
    'posting_locks/cash_bank_correction__old-reference':{sourceId:'old-reference',kind:'cash_bank_correction',entryId:'prior168'},
    'finance_workbench_receipts/old-receipt':{userId:'funding-admin',result:{sourceId:'old-reference',entryId:'prior168'}},
  };
  for(const s of fundingSources){const runId=s.payrollSource.slice(8);seed[`journal_entries/${s.journalId}`]={entryNumber:s.journalNumber,entryDate:s.existingEntryDate,
    status:'posted',sourceType:'payroll',sourceId:runId,payrollSnapshot:{runId,accounts:{payment:'1010'},totals:{net:s.netCashCreditHalala/100}},
    description:'راتب اصطناعي',lines:[{accountId:'5010',debit:s.netCashCreditHalala/100,credit:0},{accountId:'1010',debit:0,credit:s.netCashCreditHalala/100}]};}
  seed['journal_entries/prior168']={entryNumber:168,entryDate:'2026-10-25',status:'posted',sourceType:'adjustment',sourceKind:'owner_cash_bank_correction',sourceId:'old-reference',
    cashBankCorrection:{reference:'old-reference',sources:[{source:'expense:synthetic-invoice'}]},
    lines:[{accountId:'1010',debit:379968.44,credit:0},{accountId:'1020',debit:0,credit:379968.44}]};
  seed['journal_entries/opening']={entryNumber:1,entryDate:'2026-07-03',status:'posted',sourceType:'manual',lines:[
    {accountId:'1020',debit:663937.12,credit:0},{accountId:'1010',debit:0,credit:397288.44},{accountId:'3000',debit:0,credit:266648.68}]};
  for(let i=0;i<50;i++)seed[`payroll_runs/${i<22?'2026-08__r1':'2026-09__r1'}/items/synthetic-${i}`]={bikerId:`worker-${i}`,name:'عامل اصطناعي',status:'paid',netDue:100};
  for(let i=0;i<3;i++)seed[`payroll_runs/2026-09__r1/payments/synthetic-${i}`]={previewHash:`synthetic-${i}`,createdBy:'funding-admin'};
  for(let i=0;i<83;i++)seed[`temporary_expenses/synthetic-${i}`]={amount:100,status:'pending',description:'عهدة اصطناعية'};
  return seed;
}
const seed=fundingSeed();
export const fundingPolicy={...PAYROLL_CASH_FUNDING,sources:fundingSources,sourceListHash:financeHash(fundingSources),
  originalEntryHashes:Object.fromEntries(fundingSources.map(s=>[s.journalId,financeHash({...seed[`journal_entries/${s.journalId}`],id:s.journalId})]))};
export const fundingRequest={kind:'payroll_cash_funding',sourceId:fundingPolicy.reference,sources:fundingSources.map(({journalId,netCashCreditHalala})=>({journalId,netCashCreditHalala}))};
export const fundingSave=p=>({...fundingRequest,action:'save',sourceHash:p.sourceHash,previewHash:p.previewHash,previewedAt:p.previewedAt,reason:'إثبات تمويل سابق معتمد — اختبار اصطناعي فقط',confirm:true});
