import { expect, it } from 'vitest';
import { temporaryClassification } from '../administrationClassification.js';
it.each([
  [{title:'سلفة نقدية صرفها هادي',bikerId:'b'},'advances'],
  [{title:'سلفة عمال — مستند رقم 5'},'advances'],
  [{extra:{expense_name:'مصروف للعمال',expense_date:'2026-08-17',category:'worker_advance'}},'advances'],
  [{title:'رابت المشرف - July'},'salary'],[{title:'راتب احمد'},'salary'],
  [{title:'رسوم تأشيرة قريب شريك'},'official'],[{title:'بدل سعودة شريك'},'official'],
  [{title:'سداد كهرباء سكن جبرة الغرب — يخصم من الإيجار'},'housing'],[{title:'مبلغ غير معروف'},'review'],
])('proposes a location without changing the record', (row, group)=>{
  const source={id:'test',amount:100,status:'pending',...row}, before=JSON.stringify(source);
  expect(temporaryClassification(source).group).toBe(group);expect(JSON.stringify(source)).toBe(before);
});
it('keeps recovered legacy records distinct from an amount explicitly recovered',()=>{
  expect(temporaryClassification({amount:100,status:'recovered',recovered_amount:0}).outstanding).toBe(0);
  expect(temporaryClassification({amount:100,status:'pending',recovered_amount:30}).outstanding).toBe(70);
});
