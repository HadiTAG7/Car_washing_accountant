import {it,expect} from 'vitest';
import {operationsReports} from '../operationsReports.js';
import {operationsFixture} from './operationsFixture.js';
import {memoryFinanceDb} from './financeFixtures.js';
const auth={uid:'test-admin'};
it('searches the whole stored archive including text outside page one and keeps source JSON unchanged',async()=>{
  const seed={'users/test-admin':{role:'admin'}};
  for(let n=0;n<45;n++){const r=operationsFixture({round:`archive-${n}`,summary:n===1?'تفاصيل مميزة لحالة في الأرشيف':'تقرير آخر'});
    seed[`operations_reports/${r.reportId}`]={...r};seed[`operations_reports/${r.reportId}/revisions/000001`]={reportJson:JSON.stringify(r),revision:1};}
  const db=memoryFinanceDb(seed),before=JSON.stringify([...db.rows]);
  const list=async input=>operationsReports(db,auth,{action:'list',page:1,pageSize:8,...input});
  const first=await list({}),last=await list({page:6});expect(first.total).toBe(45);expect(first.items).toHaveLength(8);expect(last.items).toHaveLength(5);expect(last.pageCount).toBe(6);
  const found=await list({query:'تفاصيل مميزة'});expect(found.total).toBe(1);expect(found.items[0].round).toBe('archive-1');
  expect((await list({kind:'assets'})).total).toBe(0);expect((await list({sourceRole:7})).total).toBe(0);
  expect((await list({from:'2026-10-19'})).total).toBe(0);expect((await list({status:'partial',to:'2026-10-18'})).total).toBe(45);
  await expect(list({from:'2026-10-19',to:'2026-10-18'})).rejects.toMatchObject({code:'invalid-argument'});
  expect(JSON.stringify([...db.rows])).toBe(before);
});
