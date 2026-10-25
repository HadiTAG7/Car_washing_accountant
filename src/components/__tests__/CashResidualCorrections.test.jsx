// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import CashResidualCorrections from '../CashResidualCorrections';
const mock=vi.hoisted(()=>({api:vi.fn(),refresh:vi.fn(),allowed:true}));
vi.mock('../../hooks/useFinanceRead',()=>({useFinanceRead:()=>({allowed:mock.allowed,data:{status:'pending',sources:[{journalId:'synthetic',netCashCreditHalala:100}]},loading:false,refresh:mock.refresh})}));
vi.mock('../../lib/financeApi',()=>({callFinanceApi:(...args)=>mock.api(...args)}));
const preview={sourceHash:'a'.repeat(64),previewHash:'b'.repeat(64),previewedAt:'2026-10-25T12:00:00Z',sourceCount:22,sources:[],baseline:{entries:169},
  before:{cashHalala:-1732000,bankHalala:25830000,assetHalala:47962617},after:{cashHalala:3000,bankHalala:24095000,assetHalala:47962617},
  protectedDomains:{payrollRuns:{count:2},payrollItems:{count:50},payrollPayments:{count:3},temporaryExpenses:{count:83}}};
afterEach(()=>{cleanup();mock.api.mockReset();mock.allowed=true;});
it('keeps each reference separate and requires preview, reason and confirmation',async()=>{
  mock.api.mockResolvedValue(preview);render(<CashResidualCorrections/>);
  const first=screen.getByRole('heading',{name:'تصحيح جهة سداد المؤقتات المعتمد'}).parentElement;
  expect(mock.api).not.toHaveBeenCalled();fireEvent.click(within(first).getByRole('button',{name:'معاينة التصحيح دون حفظ'}));
  const save=await within(first).findByRole('button',{name:'تسجيل التصحيح المعتمد مرة واحدة'});expect(save.disabled).toBe(true);
  fireEvent.change(within(first).getByLabelText('سبب التصحيح'),{target:{value:'اعتماد المالك المحدد'}});fireEvent.click(within(first).getByRole('checkbox'));expect(save.disabled).toBe(false);
  expect(mock.api.mock.calls[0][1].sourceId).toBe('CEO-TEMPORARY-BANK-RECLASS-20261025-v1');
});
it('never repeats an uncertain save and refreshes the same reference',async()=>{
  mock.api.mockResolvedValueOnce(preview).mockRejectedValueOnce(Error('استجابة غير متحققة'));render(<CashResidualCorrections/>);
  const first=screen.getByRole('heading',{name:'تصحيح جهة سداد المؤقتات المعتمد'}).parentElement;
  fireEvent.click(within(first).getByRole('button',{name:'معاينة التصحيح دون حفظ'}));await within(first).findByLabelText('سبب التصحيح');
  fireEvent.change(within(first).getByLabelText('سبب التصحيح'),{target:{value:'قرار محدد'}});fireEvent.click(within(first).getByRole('checkbox'));
  fireEvent.click(within(first).getByRole('button',{name:'تسجيل التصحيح المعتمد مرة واحدة'}));await within(first).findByRole('alert');
  expect(mock.api.mock.calls.map(c=>c[1].action)).toEqual(['preview','save']);expect(mock.refresh).toHaveBeenCalled();
});
it('hides both workflows for non-admin access',()=>{mock.allowed=false;render(<CashResidualCorrections/>);expect(screen.queryByRole('heading')).toBeNull();});
