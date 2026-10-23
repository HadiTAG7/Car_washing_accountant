import { describe,it,expect } from 'vitest';
import { buildBudgetControlModel, budgetHasRecordedExpenses } from '../budgetControls';
const base={currentMonth:'2026-10',currentYear:'2026',asOfDate:'2026-10-23'};
describe('budget display correctness',()=>{
 it('allocates commission once to the exact source classification, not its substring',()=>{
   const r=buildBudgetControlModel({...base,variableCats:[{id:'old',label:'عمولات البايكرز'},{id:'auto',label:'عمولات البايكرز والموزعين',isDynamic:true}],
     washes:[{id:'wash',quantity:382,price:20,status:'مكتملة',washDate:'2026-10-20',bikerName:'Test'}]});
   expect(r.monthlyCards.find(c=>c.budget.categoryLabel==='عمولات البايكرز').spent).toBe(0);
   expect(r.monthlyCards.find(c=>c.budget.categoryLabel==='عمولات البايكرز والموزعين').spent).toBe(1719);
   expect(r.monthlySectionTotals.spent).toBe(1719);
 });
 it('does not change any recorded classification or stored budget',()=>{
   const input={...base,budgets:[{id:'b',categoryLabel:'أخرى',budgetType:'monthly',amount:100}],variables:[{id:'v',categoryId:'x',totalVariableCost:150,loggedDate:'2026-10-01'}],variableCats:[{id:'x',label:'Other'}]};
   const before=JSON.stringify(input);buildBudgetControlModel(input);expect(JSON.stringify(input)).toBe(before);
 });
 it('separates unbudgeted spend from variance instead of calling zero allocation an overrun',()=>{
   const r=buildBudgetControlModel({...base,budgets:[{id:'b',categoryLabel:'أخرى',budgetType:'monthly',amount:5000}],variableCats:[{id:'other',label:'أخرى'},{id:'fuel',label:'بنزين'}],
     variables:[{categoryId:'other',loggedDate:'2026-10-01',totalVariableCost:100},{categoryId:'fuel',loggedDate:'2026-10-02',totalVariableCost:6000}]});
   expect(r.monthlySectionTotals).toEqual({allocated:5000,spent:6100,budgetedSpent:100,unbudgetedSpent:6000,remaining:4900});
 });
 it('uses actual annual payment entries, excluding prior year/future payments, never the parent paid flag',()=>{
   const r=buildBudgetControlModel({...base,annualCats:[{id:'rent',label:'سكن العمال'}],annuals:[{id:'p',category:'rent',annualCost:180000,actualAmount:180000,paymentStatus:'paid'}],
     annualEntries:[{annualExpenseId:'p',amount:74100,spentDate:'2026-09-17'},{annualExpenseId:'p',amount:10,spentDate:'2025-10-01'},{annualExpenseId:'p',amount:20,spentDate:'2026-11-01'}]});
   expect(r.annualSectionTotals.commitment).toBe(180000);expect(r.annualSectionTotals.spent).toBe(74100);expect(r.annualSectionTotals.unpaid).toBe(105900);
   expect(r.annualCards[0].dueToDate).toBe(135000);expect(r.elapsedMonths).toBe(9);
 });
 it('does not turn an annual commitment into a monthly payment',()=>{
   const r=buildBudgetControlModel({...base,monthlyCats:[{id:'m',label:'Rent'}],annualCats:[{id:'a',label:'Rent'}],annuals:[{id:'p',category:'a',annualCost:1200}]});
   expect(r.monthlySectionTotals.spent).toBe(0);expect(r.annualSectionTotals.spent).toBe(0);expect(r.annualSectionTotals.commitment).toBe(1200);
 });
 it('reads legacy category name so Tamm is not dropped, while unused worker insurance remains zero',()=>{
   const r=buildBudgetControlModel({...base,annualCats:[{id:'gov',name:'تراخيص ورسوم حكومية'},{id:'workers',label:'تأمين العمال'}],annuals:[{id:'t',expenseName:'اشتراك تم',category:'gov',annualCost:2070,paymentStatus:'paid'}]});
   expect(r.annualCards.find(c=>c.commitment===2070).items).toEqual(['اشتراك تم']);
   expect(r.annualCards.find(c=>c.budget.categoryLabel==='تأمين العمال').commitment).toBe(0);
   expect(r.annualSectionTotals.spent).toBe(0);
 });
 it('month selection changes only monthly totals and cannot hide real spending',()=>{
   const source={...base,hiddenKeys:new Set(['monthly::Fuel']),variableCats:[{id:'f',label:'Fuel'}],variables:[{id:'v',categoryId:'f',totalVariableCost:20,loggedDate:'2026-09-01'},{id:'v2',categoryId:'f',totalVariableCost:30,loggedDate:'2026-10-01'}]};
   expect(buildBudgetControlModel(source).monthlySectionTotals.spent).toBe(30);
   expect(buildBudgetControlModel({...source,currentMonth:'2026-09'}).monthlySectionTotals.spent).toBe(20);
 });
 it('flags undated/orphan annual payments instead of inventing a date or parent',()=>{
   const r=buildBudgetControlModel({...base,annualEntries:[{annualExpenseId:'none',spentDate:'2026-10-01',amount:10}]});
   expect(r.annualIssues).toHaveLength(1);expect(r.annualSectionTotals.spent).toBe(0);
 });
 it('scales commitments, paid, due, budgeted and unbudgeted amounts consistently',()=>{
   const r=buildBudgetControlModel({...base,scalingFactor:.5,annualCats:[{id:'a',label:'Rent'}],annuals:[{id:'p',category:'a',annualCost:1200}],annualEntries:[{annualExpenseId:'p',amount:400,spentDate:'2026-09-01'}]});
   expect(r.annualSectionTotals).toMatchObject({commitment:600,spent:200,dueToDate:450,unbudgetedSpent:200,unpaid:400});
 });
});
describe('budget deletion evidence',()=>{
 it('blocks when an expense exists in any month, even zero-valued',()=>{
   expect(budgetHasRecordedExpenses({categoryLabel:'Fuel'},{variableCats:[{id:'f',label:'Fuel'}],variables:[{categoryId:'f',loggedDate:'2026-01-01',totalVariableCost:0}]})).toBe(true);
 });
 it('blocks annual plans without payment and dynamic commission wash evidence',()=>{
   expect(budgetHasRecordedExpenses({categoryLabel:'Rent'},{annualCats:[{id:'r',label:'Rent'}],annuals:[{category:'r',annualCost:10}]})).toBe(true);
   expect(budgetHasRecordedExpenses({categoryLabel:'Commission'},{variableCats:[{id:'c',label:'Commission',isDynamic:true}],washes:[{status:'مكتملة'}]})).toBe(true);
 });
 it('does not block unrelated substring labels',()=>{
   expect(budgetHasRecordedExpenses({categoryLabel:'Commission'},{variableCats:[{id:'c',label:'Commission extra'}],variables:[{categoryId:'c'}]})).toBe(false);
 });
});
