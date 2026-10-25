import {financeHash} from '../../functions/src/financeReview.js';
import {fundingSeed} from './payrollCashFundingFixture.js';
import {CASH_RESIDUAL_POLICIES} from '../cashResidualPolicies.js';
export const residualAuth={uid:'funding-admin'};
export function residualSeed(){
  const seed=fundingSeed();
  seed['chart_of_accounts/1500']={code:'1500',accountType:'asset',active:true};
  seed['chart_of_accounts/1300']={code:'1300',accountType:'asset',active:true};
  seed['journal_entries/prior169']={entryNumber:169,entryDate:'2026-10-25',sourceType:'adjustment',sourceId:'old-funding',status:'posted',
    lines:[{accountId:'1010',debit:25668.68,credit:0},{accountId:'1020',debit:0,credit:25668.68}]};
  seed['counters/journal']={nextNumber:170};
  for(const [i,s]of CASH_RESIDUAL_POLICIES[0].sources.entries()){
    seed[`temporary_expenses/synthetic-${i}`]={amount:s.netCashCreditHalala/100,status:'pending',description:'مؤقت اصطناعي'};
    seed[`journal_entries/temp-${i}`]={entryNumber:s.journalNumber,entryDate:s.entryDate,status:'posted',sourceType:'temporary_expense',sourceId:`synthetic-${i}`,
      lines:[{accountId:'1300',debit:s.netCashCreditHalala/100,credit:0},{accountId:'1010',debit:0,credit:s.netCashCreditHalala/100}]};
  }
  for(const [i,s]of CASH_RESIDUAL_POLICIES[1].sources.entries())seed[`journal_entries/reversal-${i}`]={entryNumber:s.journalNumber,entryDate:s.entryDate,
    status:i?'posted':'reversed',sourceType:s.sourceType,sourceId:`synthetic-reversal-${i}`,...(i?{reversalOf:'41'}:{}),
    lines:[{accountId:'1500',debit:i?0:30,credit:i?30:0},{accountId:'1010',debit:i?30:0,credit:i?0:30}]};
  // All payroll and advance rows are synthetic; match only the intended account totals.
  const entries=Object.entries(seed).filter(([k])=>k.startsWith('journal_entries/')&&k!=='journal_entries/opening').map(([,e])=>e);
  const targets={'1010':-17320,'1020':258300,'1500':479626.17};
  const lines=Object.entries(targets).map(([accountId,target])=>{const other=entries.flatMap(e=>e.lines).filter(l=>l.accountId===accountId).reduce((n,l)=>n+(l.debit||0)-(l.credit||0),0);
    const opening=Math.round((target-other)*100)/100;return {accountId,debit:Math.max(opening,0),credit:Math.max(-opening,0)};});
  const net=Math.round(lines.reduce((n,l)=>n+l.debit-l.credit,0)*100)/100;lines.push({accountId:'3000',debit:Math.max(-net,0),credit:Math.max(net,0)});
  seed['journal_entries/opening']={entryNumber:1,entryDate:'2026-07-03',status:'posted',sourceType:'manual',lines};
  return seed;
}
const seed=residualSeed();
export const residualPolicies=CASH_RESIDUAL_POLICIES.map((p,k)=>{
  const sources=p.sources.map((s,i)=>({...s,journalId:k?`reversal-${i}`:`temp-${i}`,sourceId:k?`synthetic-reversal-${i}`:`synthetic-${i}`}));
  return {...p,sources,sourceListHash:financeHash(sources),originalEntryHashes:Object.fromEntries(sources.map(s=>[s.journalId,financeHash({...seed[`journal_entries/${s.journalId}`],id:s.journalId})])),
    temporaryHashes:k?{}:Object.fromEntries(sources.map(s=>[s.sourceId,financeHash({...seed[`temporary_expenses/${s.sourceId}`],id:s.sourceId})]))};
});
export const residualRequest=(k,action='preview')=>({kind:'cash_residual_correction',sourceId:residualPolicies[k].reference,action,
  ...(action==='read'?{}:{sources:residualPolicies[k].sources.map(({journalId,netCashCreditHalala})=>({journalId,netCashCreditHalala}))})});
export const residualSave=(k,p)=>({...residualRequest(k,'save'),sourceHash:p.sourceHash,previewHash:p.previewHash,previewedAt:p.previewedAt,reason:'تصحيح اصطناعي معتمد في الاختبار فقط',confirm:true});
