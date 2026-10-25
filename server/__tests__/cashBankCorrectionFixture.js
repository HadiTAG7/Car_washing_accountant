import {financeHash} from '../../functions/src/financeReview.js';
import {CASH_BANK_CORRECTION} from '../../src/lib/cashBankCorrectionPolicy.js';
export const correctionAuth={uid:'correction-admin'};
export const correctionSources=Array.from({length:79},(_,i)=>({source:`expense:synthetic-${String(i).padStart(3,'0')}`,
  netCashCreditHalala:i===0?37996844-78*10000:10000}));
export const correctionPolicy={...CASH_BANK_CORRECTION,sourceListHash:financeHash(correctionSources)};
export const correctionRequest={kind:'cash_bank_correction',sourceId:correctionPolicy.reference,sources:correctionSources};
export function correctionSeed(){
  const seed={
    [`users/${correctionAuth.uid}`]:{role:'admin'},'users/another-admin':{role:'admin'},
    'chart_of_accounts/1010':{code:'1010',accountType:'asset',active:true},'chart_of_accounts/1020':{code:'1020',accountType:'asset',active:true},
    'chart_of_accounts/1500':{code:'1500',accountType:'asset',active:true},'chart_of_accounts/1300':{code:'1300',accountType:'asset',active:true},
    'chart_of_accounts/3000':{code:'3000',accountType:'equity',active:true},
    'accounting_periods/2026-10':{status:'open',periodKey:'2026-10'},'accounting_periods/2026-06':{status:'closed'},
    'counters/journal':{nextNumber:82,earliestEntryDate:'2026-06-01'},
  };
  for(const [i,s] of correctionSources.entries()){
    const sourceId=s.source.slice(8);
    seed[`startup_cost_entries/${sourceId}`]={description:`فاتورة اصطناعية ${i}`,amount:s.netCashCreditHalala/100,spent_date:'2026-06-01'};
    seed[`journal_entries/original-${i}`]={sourceId,sourceType:'expense',sourceKind:'startup',entryNumber:i+1,entryDate:'2026-06-01',status:'posted',description:'مصروف اصطناعي',
      lines:[{accountId:'1500',debit:s.netCashCreditHalala/100,credit:0},{accountId:'1010',debit:0,credit:s.netCashCreditHalala/100}]};
  }
  seed['journal_entries/bank-opening']={entryNumber:80,entryDate:'2026-07-03',status:'posted',sourceType:'partner_payment',description:'رأس مال اصطناعي',
    lines:[{accountId:'1020',debit:663937.12,credit:0},{accountId:'3000',debit:0,credit:663937.12}]};
  seed['journal_entries/outside-scope']={entryNumber:81,entryDate:'2026-06-01',status:'posted',sourceType:'temporary_expense',description:'خارج النطاق',
    lines:[{accountId:'1300',debit:42988.68,credit:0},{accountId:'1010',debit:0,credit:42988.68}]};
  return seed;
}
export const correctionSave=p=>({...correctionRequest,action:'save',sourceHash:p.sourceHash,previewHash:p.previewHash,previewedAt:p.previewedAt,
  reason:'تصحيح معتمد بقرار المالك من معاينة اصطناعية',confirm:true});
