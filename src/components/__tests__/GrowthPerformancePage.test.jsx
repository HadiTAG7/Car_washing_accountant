// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,expect,it} from 'vitest';
import {GrowthPerformanceContent,GrowthPerformanceView} from '../GrowthPerformancePage';
import {growthFixture} from './growthFixture';
afterEach(cleanup);
describe('current growth performance display',()=>{
 it('uses branded date selection and explicit submission, retaining future-date validation',()=>{
  const changes=[];render(<GrowthPerformanceContent source={{allowed:true,error:'test'}} period={{from:'2026-10-03',to:'2026-10-17'}} onPeriodChange={p=>changes.push(p)}/>);
  fireEvent.click(screen.getByRole('button',{name:'من'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'4',exact:true}));expect(changes).toEqual([]);fireEvent.click(screen.getByRole('button',{name:'عرض الفترة'}));expect(changes).toEqual([{from:'2026-10-04',to:'2026-10-17'}]);
 });
 it('rejects a future period without reloading the document',()=>{
  const changes=[];render(<GrowthPerformanceContent source={{allowed:true,error:'test'}} period={{from:'2099-10-03',to:'2099-10-17'}} onPeriodChange={p=>changes.push(p)}/>);fireEvent.click(screen.getByRole('button',{name:'عرض الفترة'}));expect(changes).toEqual([]);expect(screen.getAllByRole('alert').some(e=>e.textContent.includes('93'))).toBe(true);
 });
 it('shows one compact warning disclosure and a dated location-only snapshot line',()=>{
  const data={...growthFixture(),warnings:[{code:'unknown-zone',count:3}]};const {container}=render(<GrowthPerformanceView data={data}/>);
  expect(container.firstElementChild.dir).toBe('rtl');expect(screen.getByText(/آخر لقطة مواقع من سويتر/)).toBeTruthy();
  const warning=container.querySelector('.sw-growth__warnings');expect(warning.open).toBe(false);fireEvent.click(within(warning).getByText('تفاصيل'));expect(warning.querySelectorAll('summary')).toHaveLength(1);
  expect(screen.queryByText(/Active بحسب لقطة/)).toBeNull();
 });
 it('keeps cards, chart, and table aligned when selecting a biker or zone',()=>{
  const {container}=render(<GrowthPerformanceView data={growthFixture()} language="en"/>);const total=()=>container.querySelector('.sw-growth__card strong').textContent;
  expect(total()).toBe('252');fireEvent.change(screen.getByLabelText('Biker'),{target:{value:'fixture-1984'}});expect(total()).toBe('42');expect(screen.getByText(/Displayed bikers:/).textContent).toBe('Displayed bikers: 1 of 7');expect(screen.getByRole('heading',{name:/Biker trend/}).textContent).toMatch(/Synthetic biker/);
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Zone'),{target:{value:'Wurood'}});expect(screen.getByLabelText('Biker').value).toBe('all');expect(total()).toBe('168');
 });
 it('sorts the table by the available-day rate and clicking a row selects its own trend',()=>{
  const data=growthFixture();data.workers[1].availability[0]={periodKey:'2026-10',startDate:'2026-10-16',endDate:'2026-10-31',daysEntitled:16};data.workers[1].startDate='2026-10-16';data.workers[1].days=data.workers[1].days.map(d=>d.date<'2026-10-16'?{...d,count:0}:d);
  const {container}=render(<GrowthPerformanceView data={data} language="en"/>);const first=within(screen.getByRole('table')).getAllByRole('row')[1];expect(within(first).getByRole('button').textContent).toMatch(/Synthetic biker/);fireEvent.click(within(first).getByRole('button'));expect(container.querySelector('.sw-growth__card strong').textContent).toBe('12');
 });
 it('retains keyboard focus when day details close and exposes no write action',()=>{
  const {container}=render(<GrowthPerformanceView data={growthFixture()} language="en"/>);const day=container.querySelector('.sw-growth__chart button');day.focus();fireEvent.click(day);const close=screen.getByRole('button',{name:'Close details'});close.focus();fireEvent.click(close);expect(document.activeElement).toBe(day);expect(screen.queryByRole('button',{name:/Save|Post|Approve/})).toBeNull();
 });
 it('renders loading, retry and read failures without fake totals',()=>{
  const source={allowed:true,error:'Read failed',retry:()=>{}},p=render(<GrowthPerformanceContent source={source} period={{from:'2026-10-01',to:'2026-10-17'}} onPeriodChange={()=>{}} language="en"/>);
  expect(screen.getByRole('alert').textContent).toContain('Read failed');p.rerender(<GrowthPerformanceContent source={{allowed:true,loading:true}} period={{from:'2026-10-01',to:'2026-10-17'}} onPeriodChange={()=>{}} language="en"/>);expect(screen.getByRole('status').textContent).toContain('Loading growth');
 });
});
