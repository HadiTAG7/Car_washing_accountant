import { describe, it, expect } from 'vitest';
import { housingOverview, housingInactive, housingLeaseEvidence, housingBikerHref } from '../housingOverview';

const today='2026-10-27';
const resident=(id,patch={})=>({id,residence:'سكن الشمال',currentStatus:'شغال',...patch});
const lease={id:'lease',annualExpenseId:'rent',unit:'سكن الشرق',amount:28600,spentDate:'2026-09-25',housingEvidence:{paymentStatus:'paid',purpose:'عقد123 لمدة سنة 16 سبتمبر 2026–15 سبتمبر 2027؛28600 ولا خدمات إضافية.'}};
const sources={today,items:[{id:'f',units:['سكن الشمال','سكن الشرق'],plannedAmount:1000,quantity:10}],
  entries:[{id:'f1',startupCostId:'f',unit:'سكن الشمال',amount:500},{id:'f2',startupCostId:'f',unit:'سكن الشرق',amount:300}],
  metaRows:[{name:'سكن الشمال',capacity:4},{name:'سكن الشرق',capacity:2}],
  annualItems:[{id:'rent',expenseName:'سكن العمال',annualCost:180000,units:['سكن الشمال','سكن الشرق']}],annualEntries:[lease]};
describe('housing read model',()=>{
  it('separates inactive links without treating their beds as vacated',()=>{
    const input={...sources,bikers:[resident('a'),resident('b',{currentStatus:'هرب مع الشريحة'}),resident('c',{endDate:'2026-10-26'}),resident('d',{endDate:'2026-11-01'})]};
    const before=JSON.stringify(input);const model=housingOverview(input),north=model.rows[0];
    expect(north.active.map(b=>b.id)).toEqual(['a','d']);expect(north.inactive.map(b=>b.id)).toEqual(['b','c']);
    expect(north.vacant).toBe(0);expect(north.afterEviction).toBe(2);expect(JSON.stringify(input)).toBe(before);
  });
  it('supports every departure variant and never crashes on an invalid end date',()=>{
    for(const currentStatus of ['هرب','هرب مع الاجهزة','مشيناه'])expect(housingInactive({currentStatus},today)).toBe(true);
    expect(housingInactive({endDate:today},today)).toBe(true);expect(housingInactive({endDate:'2026-13-40'},today)).toBe(false);
  });
  it('keeps one physical unit across plans and includes meta/rent-only units',()=>{
    const result=housingOverview({...sources,items:[...sources.items,{id:'other',units:['سكن الشمال'],quantity:1}],entries:[...sources.entries,{startupCostId:'other',unit:'سكن الشمال',amount:200}],metaRows:[...sources.metaRows,{name:'سكن الغرب',capacity:null}],bikers:[resident('a')]});
    expect(result.rows).toHaveLength(3);expect(result.rows[0].cost).toBe(700);expect(result.rows[0].residents).toHaveLength(1);expect(result.rows[2].vacant).toBeNull();
  });
  it('does not divide the shared budget or a payment by 12 to invent rent',()=>{
    const north=housingOverview({...sources,annualEntries:[{annualExpenseId:'rent',unit:'سكن الشمال',amount:27000}],bikers:[resident('a')]}).rows[0];
    expect(north.recorded).toBe(27000);expect(north.annual).toBeNull();expect(north.monthly).toBeNull();expect(north.perActiveMonthly).toBeNull();expect(north.remaining).toBeNull();
  });
  it('uses explicit current reviewed contract, not obsolete notes or payment amount',()=>{
    const east=housingOverview({...sources,annualEntries:[{...lease,notes:'الإيجار السنوي 28300'}],bikers:[resident('a',{residence:'سكن الشرق'})]}).rows[1];
    expect(east.annual).toBe(28600);expect(east.monthly).toBe(2383.33);expect(east.perActiveMonthly).toBe(2383.33);expect(east.paid).toBe(28600);expect(east.remaining).toBe(0);expect(east.cost).toBe(300);expect(east.nextPayment).toBeNull();
  });
  it('accepts the other explicit yearly contract including advance payment before its start',()=>{
    const west={...lease,amount:18500,spentDate:'2026-08-16',housingEvidence:{paymentStatus:'paid',purpose:'عقد123:18أغسطس2026–17أغسطس2027 بسنة واحدة 18500 دون خدمات.'}};
    expect(housingLeaseEvidence(west)).toMatchObject({annual:18500,from:'2026-08-18',to:'2027-08-17'});
    const east=housingOverview({...sources,annualEntries:[west]}).rows[1];expect(east.paid).toBe(18500);expect(east.remaining).toBe(0);
  });
  it('fails closed for ambiguous prices, expired evidence, and unsupported prose',()=>{
    expect(housingLeaseEvidence({...lease,housingEvidence:{purpose:lease.housingEvidence.purpose+'؛30000 ريال'}})).toBeNull();
    expect(housingLeaseEvidence({...lease,housingEvidence:{purpose:'الإيجار السنوي 28600'}})).toBeNull();
    expect(housingOverview({...sources,today:'2027-10-27'}).rows[1].annual).toBeNull();
  });
  it('only alerts on a full unit when an active biker needs housing; unknown capacity is unknown',()=>{
    const model=housingOverview({...sources,metaRows:[{name:'سكن الشمال',capacity:1}],bikers:[resident('a'),resident('b',{residence:''}),resident('c',{residence:'',currentStatus:'مشيناه'})]});
    expect(model.unhoused.map(b=>b.id)).toEqual(['b']);expect(model.alerts).toContainEqual({kind:'full',unit:'سكن الشمال',count:1});expect(model.rows[1].capacity).toBeNull();
  });
  it('does not hide unassigned setup or rental entries',()=>{
    const model=housingOverview({...sources,entries:[...sources.entries,{startupCostId:'f',amount:123}],annualEntries:[...sources.annualEntries,{annualExpenseId:'rent',amount:456}]});
    expect(model.setupUnassigned).toBe(123);expect(model.rentUnassigned).toBe(456);expect(housingBikerHref('a/b')).toBe('?page=bikers&bikerId=a%2Fb');
  });
  it('alerts within 30 days only for an explicit dedicated plan and keeps overdue dates',()=>{
    const input={...sources,annualItems:[{id:'rent',expenseName:'إيجار',annualCost:12000,units:['سكن الشمال'],paymentMonth:11,paymentDay:26}],annualEntries:[]};
    expect(housingOverview(input).alerts).toContainEqual({kind:'due',unit:'سكن الشمال',date:'2026-11-26',days:30,amount:12000});
    expect(housingOverview({...input,today:'2026-10-26'}).alerts).toHaveLength(0);
    expect(housingOverview({...input,today:'2026-11-27'}).rows[0].nextPayment.days).toBe(-1);
    expect(housingOverview({...input,annualItems:[{...input.annualItems[0],paymentMonth:2,paymentDay:31}]}).rows[0].nextPayment).toBeNull();
  });
});
