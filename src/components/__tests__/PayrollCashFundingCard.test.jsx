// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import PayrollCashFundingCard from '../PayrollCashFundingCard';
const mock=vi.hoisted(()=>({api:vi.fn(),refresh:vi.fn(),allowed:true}));
vi.mock('../../hooks/useFinanceRead',()=>({useFinanceRead:()=>({allowed:mock.allowed,data:{status:'pending',sources:Array.from({length:4},(_,i)=>({journalId:`synthetic-${i}`,netCashCreditHalala:100}))},loading:false,refresh:mock.refresh})}));
vi.mock('../../lib/financeApi',()=>({callFinanceApi:(...args)=>mock.api(...args)}));
const preview={previewedAt:'2026-10-25T10:00:00.000Z',sourceHash:'a'.repeat(64),previewHash:'b'.repeat(64),sourceCount:4,sources:[],
  before:{cashHalala:-4298868,bankHalala:28396868},after:{cashHalala:-1732000,bankHalala:25830000},baseline:{entries:168},
  protectedDomains:{payrollRuns:{count:2},payrollItems:{count:50},payrollPayments:{count:3},temporaryExpenses:{count:83}}};
beforeEach(()=>{mock.allowed=true;mock.api.mockReset();mock.refresh.mockReset();});afterEach(cleanup);
it('requires a fresh preview, reason and confirmation; sends four original IDs and no financial override',async()=>{
  mock.api.mockResolvedValue(preview);render(<PayrollCashFundingCard/>);expect(mock.api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'معاينة التمويل دون حفظ'}));
  const save=await screen.findByRole('button',{name:'تسجيل التمويل المعتمد مرة واحدة'});expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('سبب التصحيح'),{target:{value:'قرار هادي المحدد'}});expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));expect(save.disabled).toBe(false);
  const req=mock.api.mock.calls[0][1];expect(req.kind).toBe('payroll_cash_funding');expect(req.sources).toHaveLength(4);
  expect(Object.keys(req.sources[0]).sort()).toEqual(['journalId','netCashCreditHalala']);expect(req.amount).toBeUndefined();
});
it('reads the receipt after saving and never repeats a lost response',async()=>{
  mock.api.mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error('استجابة غير متحققة'));
  render(<PayrollCashFundingCard/>);fireEvent.click(screen.getByRole('button',{name:'معاينة التمويل دون حفظ'}));
  await screen.findByRole('button',{name:'تسجيل التمويل المعتمد مرة واحدة'});
  fireEvent.change(screen.getByLabelText('سبب التصحيح'),{target:{value:'قرار المالك'}});fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'تسجيل التمويل المعتمد مرة واحدة'}));await screen.findByRole('alert');
  expect(mock.api.mock.calls.map(c=>c[1].action)).toEqual(['preview','save']);expect(mock.refresh).toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'تسجيل التمويل المعتمد مرة واحدة'})).toBeNull();
});
it('verifies receipt identity and callback after a successful isolated save',async()=>{
  const receipt={completed:true,entryId:'synthetic-entry',entryNumber:169,sourceHash:'r'};
  mock.api.mockResolvedValueOnce(preview).mockResolvedValueOnce(receipt).mockResolvedValueOnce(receipt);const onSaved=vi.fn();
  render(<PayrollCashFundingCard onSaved={onSaved}/>);fireEvent.click(screen.getByRole('button',{name:'معاينة التمويل دون حفظ'}));
  await screen.findByRole('button',{name:'تسجيل التمويل المعتمد مرة واحدة'});
  fireEvent.change(screen.getByLabelText('سبب التصحيح'),{target:{value:'قرار هادي'}});fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'تسجيل التمويل المعتمد مرة واحدة'}));await screen.findByText('التمويل محفوظ؛ لن يُسجّل مرة ثانية.');
  expect(mock.api.mock.calls.map(c=>c[1].action)).toEqual(['preview','save','read']);expect(onSaved).toHaveBeenCalledWith('synthetic-entry');
});
it('hides the workflow outside admin access',()=>{mock.allowed=false;render(<PayrollCashFundingCard/>);expect(screen.queryByRole('button')).toBeNull();});
