import { expect, it } from 'vitest';
import { managementShareAmount, monthlyFeeRules } from '../managementShare.js';

it.each([[10000,1500],[-10000,0],[0,0]])('management share for monthly profit %s is %s', (profit, expected) => {
  expect(managementShareAmount(profit)).toBe(expected);
});
it('does not carry a loss or an unpaid estimate into later months',()=>{
  expect([-10000,0,10000].map(managementShareAmount)).toEqual([0,0,1500]);
});
it('replaces both legacy percentages with one profit share without mutating saved rules',()=>{
  const rules=[{key:'management',rate:0.1,basis:'profit'},{key:'supervisor',rate:0.05,basis:'profit'}];
  const before=JSON.stringify(rules), current=monthlyFeeRules(rules,'2026-10-31');
  expect(current).toHaveLength(1);expect(current[0]).toMatchObject({key:'management',rate:0.15,basis:'profit'});
  expect(JSON.stringify(rules)).toBe(before);
});
