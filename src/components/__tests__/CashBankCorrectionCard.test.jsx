// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import CashBankCorrectionCard from '../CashBankCorrectionCard';
const mock=vi.hoisted(()=>({api:vi.fn(),refresh:vi.fn(),allowed:true}));
vi.mock('../../hooks/useFinanceRead',()=>({useFinanceRead:()=>({allowed:mock.allowed,data:{status:'pending'},loading:false,refresh:mock.refresh})}));
vi.mock('../../lib/financeApi',()=>({callFinanceApi:(...args)=>mock.api(...args)}));
const sources=Array.from({length:79},(_,i)=>({source:`expense:TEST-${i}`,netCashCreditHalala:100}));
const preview={previewedAt:'2026-10-25T08:00:00.000Z',previewHash:'a'.repeat(64),sourceHash:'b'.repeat(64),sourceCount:79,
  baseline:{entries:167},before:{cashHalala:-42295712,bankHalala:66393712},after:{cashHalala:-4298868,bankHalala:28396868},sources:[]};
const upload=()=>fireEvent.change(screen.getByLabelText('قائمة المصادر المعتمدة'),{target:{files:[{size:100,text:async()=>JSON.stringify({sources})}]}});
beforeEach(()=>{mock.allowed=true;mock.api.mockReset();mock.refresh.mockReset();});afterEach(cleanup);
it('requires the approved list, a preview, reason and explicit confirmation before any save',async()=>{
  mock.api.mockResolvedValue(preview);render(<CashBankCorrectionCard/>);
  expect(screen.getByRole('button',{name:'معاينة التصحيح دون حفظ'}).disabled).toBe(true);expect(mock.api).not.toHaveBeenCalled();
  upload();await waitFor(()=>expect(screen.getByRole('button',{name:'معاينة التصحيح دون حفظ'}).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'معاينة التصحيح دون حفظ'}));
  const execute=await screen.findByRole('button',{name:'تنفيذ التصحيح المعتمد مرة واحدة'});expect(execute.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('سبب التصحيح'),{target:{value:'سبب من المراجع'}});expect(execute.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));expect(execute.disabled).toBe(false);
  expect(mock.api.mock.calls.map(c=>c[1].action)).toEqual(['preview']);
});
it('verifies a saved receipt by reading status and never repeats a write automatically after a lost response',async()=>{
  mock.api.mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error('استجابة غير متحققة'));
  render(<CashBankCorrectionCard/>);upload();await waitFor(()=>expect(screen.getByRole('button',{name:'معاينة التصحيح دون حفظ'}).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'معاينة التصحيح دون حفظ'}));await screen.findByRole('button',{name:'تنفيذ التصحيح المعتمد مرة واحدة'});
  fireEvent.change(screen.getByLabelText('سبب التصحيح'),{target:{value:'قرار المالك المحدد'}});fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'تنفيذ التصحيح المعتمد مرة واحدة'}));
  await screen.findByRole('alert');expect(mock.api.mock.calls.map(c=>c[1].action)).toEqual(['preview','save']);
  expect(screen.queryByRole('button',{name:'تنفيذ التصحيح المعتمد مرة واحدة'})).toBeNull();expect(mock.refresh).toHaveBeenCalled();
});
it('returns no workflow outside the admin view',()=>{mock.allowed=false;render(<CashBankCorrectionCard/>);expect(screen.queryByText('تصحيح الصندوق المعتمد')).toBeNull();});
