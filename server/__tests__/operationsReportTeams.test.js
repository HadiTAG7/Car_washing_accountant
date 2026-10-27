import { expect, it } from 'vitest';
import { operationsReports } from '../operationsReports.js';
import { memoryFinanceDb } from './financeFixtures.js';

it('groups historical managers before paging, retains original attribution, and writes nothing', async () => {
  const seed = { 'users/admin': { role: 'admin' } };
  for (let index = 0; index < 12; index++) {
    const role = [4, 6, 12, 7, 8, 4][index % 6], label = ({ 4:'4: مدير العمليات', 6:'مدير العمليات — الرقم الأصلي6 قبل الدمج', 12:'مدير العمليات — الرقم الأصلي12 قبل إعادة الترقيم', 7:'مزامنة العمليات — الرقم الأصلي7 قبل الدمج', 8:'الأصول والصيانة — الرقم الأصلي8 قبل الدمج' })[role];
    seed[`operations_reports/report-${index}`] = { reportId:`report-${index}`,sourceRole:role,sourceLabel:label,dateRiyadh:'2026-10-27',cutAtRiyadh:`2026-10-27T09:${String(index).padStart(2,'0')}:00+03:00`,title:'تقرير محفوظ',revision:1 };
  }
  const db = memoryFinanceDb(seed), before = JSON.stringify([...db.rows]);
  const result = await operationsReports(db,{uid:'admin'},{action:'list',team:'operations',page:2,pageSize:3});
  expect(result.total).toBe(8); expect(result.pageCount).toBe(3); expect(result.items).toHaveLength(3);
  expect(result.items.every(item=>[4,6,12].includes(item.sourceRole))).toBe(true);
  expect(result.teamOptions.map(team=>team.label)).toEqual(['مدير العمليات','المزامنة','الأصول والصيانة']);
  expect(result.teamOptions[0].tooltip).toContain('الأصلي12');
  const legacy = await operationsReports(db,{uid:'admin'},{action:'list',sourceRole:12,page:1});
  expect(legacy.total).toBe(2); expect(legacy.items.every(item=>item.sourceRole===12)).toBe(true);
  expect(JSON.stringify([...db.rows])).toBe(before);
});
