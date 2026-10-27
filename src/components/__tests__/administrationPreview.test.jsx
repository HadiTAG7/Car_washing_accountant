// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import AdministrationExpensesPage from '../AdministrationExpensesPage';
import BikerAdvancesTab from '../BikerAdvancesTab';
const state=vi.hoisted(()=>({role:'admin',isPartnerView:false,write:vi.fn(),expenses:[
  {id:'a',title:'سلفة بايكر',bikerId:'b',amount:100,status:'pending',spentDate:'2026-10-01'},
  {id:'b',title:'راتب احمد',amount:2500,status:'pending',spentDate:'2026-07-01'},
  {id:'c',title:'رسوم تغيير رأس المال',amount:100,status:'pending',spentDate:'2026-06-01'},
]}));
vi.mock('../../contexts/PartnerViewContext',()=>({usePartnerView:()=>state}));
vi.mock('../../hooks/useTemporaryExpenses',()=>({useTemporaryExpenses:()=>({expenses:state.expenses,loading:false,addTemporaryExpense:state.write,toggleRecoveryStatus:state.write,deleteTemporaryExpense:state.write})}));
vi.mock('../../hooks/useBikers',()=>({useBikers:()=>({bikers:[{id:'b',name:'عامل اختباري'}],loading:false})}));
vi.mock('../AdministrationShareTable',()=>({default:()=> <p>حصة شهرية من نتيجة قائمة الدخل</p>}));
afterEach(()=>{cleanup();state.role='admin';state.isPartnerView=false;state.write.mockClear();});
it('shows proposed groups without approval, recovery, delete or save actions',()=>{
  const before=JSON.stringify(state.expenses);render(<AdministrationExpensesPage/>);
  expect(screen.getByRole('heading',{name:'معاينة التصنيف المقترح'})).toBeTruthy();
  expect(screen.getByRole('heading',{name:'رواتب الإدارة'})).toBeTruthy();
  expect(screen.getByRole('heading',{name:'الرسوم الحكومية والرسمية'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:/حفظ|حذف|اعتماد|استرداد|نقل/})).toBeNull();
  expect(state.write).not.toHaveBeenCalled();expect(JSON.stringify(state.expenses)).toBe(before);
});
it('keeps the proposed raw register out of a real or previewed partner view',()=>{
  state.isPartnerView=true;render(<AdministrationExpensesPage/>);
  expect(screen.queryByText('راتب احمد')).toBeNull();expect(screen.queryByRole('table')).toBeNull();
});
it('shows advances with their current recovery state and opens the existing payroll tab only',()=>{
  const payroll=vi.fn();render(<BikerAdvancesTab expenses={state.expenses} bikers={[{id:'b',name:'عامل اختباري'}]} onPayroll={payroll}/>);
  expect(screen.getByText('سلفة بايكر')).toBeTruthy();expect(screen.queryByText('راتب احمد')).toBeNull();
  expect(screen.getByText('بانتظار الاسترداد')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'فتح مسير الرواتب'}));expect(payroll).toHaveBeenCalledOnce();expect(state.write).not.toHaveBeenCalled();
});
