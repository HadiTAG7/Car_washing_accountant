import { variableItemsForMonth, monthOf } from './variableExpenseTotals.js';
import { isRealCalendarDate } from './vatFields.js';

const round = n => Math.round(n * 100) / 100;
export const budgetLabelKey = value => String(value || '').trim().toLowerCase().replace(/[-_,./|]+/g,' ').replace(/\s+/g,' ').trim();
export const budgetCategoryName = row => String(row?.label || row?.name || '').trim();
const labels = rows => new Map(rows.map(row => [row.id, budgetCategoryName(row)]));
const kindLabel = (map, id) => map.get(id) || 'تصنيف غير معروف';

/** Evidence is all-time, not just the visible month. Exact categories never inherit a substring's spend. */
export function budgetHasRecordedExpenses(budget, {monthlies=[],monthlyCats=[],annuals=[],annualCats=[],variables=[],variableCats=[],washes=[]}={}) {
  const target=budgetLabelKey(budget.categoryLabel);
  const monthlyMap=labels(monthlyCats),annualMap=labels(annualCats),variableMap=labels(variableCats);
  const match=(map,id)=>budgetLabelKey(kindLabel(map,id))===target;
  if(!target) return false;
  if(monthlies.some(r=>match(monthlyMap,r.categoryId)) || variables.some(r=>match(variableMap,r.categoryId))
    || annuals.some(r=>match(annualMap,r.category))) return true;
  return variableCats.some(c=>c.isDynamic && budgetLabelKey(budgetCategoryName(c))===target)
    && washes.some(w=>w.status==='مكتملة');
}

/** Read-only management view. Annual commitments are not payments, nor monthly expenses. */
export function buildBudgetControlModel({ budgets=[],monthlies=[],monthlyCats=[],annuals=[],annualCats=[],annualEntries=[],variables=[],variableCats=[],washes=[],
  hiddenKeys=new Set(),currentMonth,currentYear,asOfDate=`${currentYear}-12-31`,scalingFactor=1 }={}) {
  const monthlyMap=labels(monthlyCats),variableMap=labels(variableCats),annualMap=labels(annualCats);
  const byKey=new Map();
  const add=(type,label,budget=null)=>{
    const normalized=budgetLabelKey(label); if(!normalized)return;
    const key=`${type}::${normalized}`;
    if(!byKey.has(key))byKey.set(key,{budget:budget?{...budget,isVirtual:false}:{id:`virtual-${type}-${normalized}`,budgetType:type,categoryLabel:label,amount:0,isVirtual:true},
      spent:0,commitment:0,dueToDate:0,items:[],hasExpenses:false});
  };
  budgets.forEach(b=>add(b.budgetType,b.categoryLabel,b));
  [...monthlyCats,...variableCats].forEach(c=>add('monthly',budgetCategoryName(c) || 'تصنيف غير معروف'));
  annualCats.forEach(c=>add('annual',budgetCategoryName(c) || 'تصنيف غير معروف'));
  monthlies.forEach(r=>add('monthly',kindLabel(monthlyMap,r.categoryId)));
  variables.forEach(r=>add('monthly',kindLabel(variableMap,r.categoryId)));
  annuals.forEach(r=>add('annual',kindLabel(annualMap,r.category)));
  const get=(type,label)=>byKey.get(`${type}::${budgetLabelKey(label)}`);
  for(const row of monthlies) {
    if(row.recurrence==='one_time' && monthOf(row.loggedDate)!==currentMonth)continue;
    const card=get('monthly',kindLabel(monthlyMap,row.categoryId));card.spent+=Number(row.totalMonthlyCost)||0;
  }
  for(const row of variableItemsForMonth({manualItems:variables,categories:variableCats,selectedMonth:currentMonth,washes})) {
    const card=get('monthly',kindLabel(variableMap,row.categoryId));card.spent+=Number(row.totalVariableCost)||0;
  }
  const planMap=new Map(annuals.map(a=>[a.id,a]));
  const year=String(currentYear),asOfYear=asOfDate.slice(0,4);
  const elapsedMonths=year<asOfYear?12:year>asOfYear?0:Math.max(0,Number(asOfDate.slice(5,7))-1);
  const cutoff=year<asOfYear?`${year}-12-31`:asOfDate;
  const annualIssues=[];
  for(const plan of annuals) {
    const card=get('annual',kindLabel(annualMap,plan.category));
    card.commitment+=Number(plan.annualCost)||0;card.items.push(plan.expenseName);
  }
  for(const entry of annualEntries) {
    const plan=planMap.get(entry.annualExpenseId);
    if(!plan || !isRealCalendarDate(entry.spentDate)){annualIssues.push(entry);continue;}
    if(entry.spentDate.slice(0,4)!==year || entry.spentDate>cutoff)continue;
    get('annual',kindLabel(annualMap,plan.category)).spent+=Number(entry.amount)||0;
  }
  const allCards=[...byKey.values()].map(card=>{
    const hasExpenses=budgetHasRecordedExpenses(card.budget,{monthlies,monthlyCats,annuals,annualCats,variables,variableCats,washes});
    return {...card,hasExpenses,spent:round(card.spent*scalingFactor),commitment:round(card.commitment*scalingFactor),
      dueToDate:round(card.commitment*elapsedMonths/12*scalingFactor),budget:{...card.budget,amount:round((card.budget.amount||0)*scalingFactor)}};
  });
  // Hiding a zero placeholder must never remove real spending from headline totals.
  const cards=allCards.filter(c=>!c.budget.isVirtual || c.hasExpenses || !hiddenKeys.has(`${c.budget.budgetType}::${budgetLabelKey(c.budget.categoryLabel)}`));
  const monthlyCards=cards.filter(c=>c.budget.budgetType==='monthly').sort((a,b)=>a.budget.categoryLabel.localeCompare(b.budget.categoryLabel,'ar'));
  const annualCards=cards.filter(c=>c.budget.budgetType==='annual').sort((a,b)=>a.budget.categoryLabel.localeCompare(b.budget.categoryLabel,'ar'));
  const summarize=list=>{
    const allocated=round(list.reduce((s,c)=>s+c.budget.amount,0));
    const spent=round(list.reduce((s,c)=>s+c.spent,0));
    const budgetedSpent=round(list.filter(c=>c.budget.amount>0).reduce((s,c)=>s+c.spent,0));
    return {allocated,spent,budgetedSpent,unbudgetedSpent:round(spent-budgetedSpent),remaining:round(allocated-budgetedSpent)};
  };
  const annualSectionTotals={...summarize(annualCards),commitment:round(annualCards.reduce((s,c)=>s+c.commitment,0)),
    dueToDate:round(annualCards.reduce((s,c)=>s+c.dueToDate,0))};
  annualSectionTotals.unpaid=round(annualSectionTotals.commitment-annualSectionTotals.spent);
  return {cards,monthlyCards,annualCards,totals:summarize(allCards),monthlySectionTotals:summarize(monthlyCards),annualSectionTotals,elapsedMonths,annualIssues,
    suggestions:[...new Set(allCards.map(c=>c.budget.categoryLabel))].sort((a,b)=>a.localeCompare(b,'ar'))};
}
