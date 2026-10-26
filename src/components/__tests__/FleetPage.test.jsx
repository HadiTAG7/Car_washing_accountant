// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react';
const mocks=vi.hoisted(()=>({view:{role:'admin',isPartnerView:false},read:vi.fn(),save:vi.fn()}));
vi.mock('../../contexts/PartnerViewContext',()=>({usePartnerView:()=>mocks.view}));
vi.mock('../../hooks/useFleet',()=>({useFleet:()=>mocks.read()}));
vi.mock('../../hooks/useOverviewDashboard',()=>({useOverviewDashboard:()=>({})}));
vi.mock('../../hooks/useIdleBikersData',()=>({useIdleBikersData:()=>({value:{rows:[{reasonKey:'no_bike'}]}})}));
vi.mock('../../lib/bikerProfile',()=>({riyadhToday:()=> '2026-10-27'}));
vi.mock('../TopBar',()=>({default:()=>null}));
import FleetPage from '../FleetPage';
import { FLEET_CSV_COLUMNS } from '../../lib/fleet';
const state=()=>({canEdit:true,data:{bikes:[],assignments:[],maintenance:[],incidents:[],policies:[],bikers:[],startup:[]},save:mocks.save,refetch:vi.fn()});
beforeEach(()=>{mocks.view={role:'admin',isPartnerView:false};mocks.read.mockReturnValue(state());mocks.save.mockResolvedValue({});});
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('never mounts protected reads for partners or operators',()=>{
  mocks.view.role='operator';const page=render(<FleetPage/>);expect(mocks.read).not.toHaveBeenCalled();mocks.view={role:'admin',isPartnerView:true};page.rerender(<FleetPage/>);expect(mocks.read).not.toHaveBeenCalled();
});
it('starts with an empty source register and no assumed purchase date, status or save',()=>{
  render(<FleetPage/>);expect(screen.getByText('ما تسجلت بيانات الدبابات بعد')).toBeTruthy();const form=screen.getByRole('form',{name:'إضافة دباب فعلي'});
  expect(within(form).getByLabelText('الحالة').value).toBe('');expect(mocks.save).not.toHaveBeenCalled();
  expect(within(form).getByRole('button',{name:'تاريخ الشراء'}).textContent).not.toContain('2026');
});
it('preserves a typed bike draft across keyboard tab navigation and submits only explicit metadata',async()=>{
  render(<FleetPage/>);const form=screen.getByRole('form',{name:'إضافة دباب فعلي'});
  fireEvent.change(within(form).getByLabelText('الرقم الداخلي'),{target:{value:'REAL-01'}});fireEvent.change(within(form).getByLabelText('الحالة'),{target:{value:'working'}});
  fireEvent.keyDown(screen.getByRole('tab',{name:'الدبابات'}),{key:'ArrowLeft'});expect(screen.getByRole('tab',{name:'التسليم'}).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab',{name:'الدبابات'}));expect(within(screen.getByRole('form',{name:'إضافة دباب فعلي'})).getByLabelText('الرقم الداخلي').value).toBe('REAL-01');
  fireEvent.submit(form);await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith({kind:'bike',id:undefined,expectedRevision:0,data:{internalNumber:'REAL-01',plate:'',model:'',purchasedOn:'',startupItemId:'',status:'working',statusSince:'',policyId:''}}));
});
it('reads shared alerts, historical handovers and claims without saving anything',()=>{
  const s=state();s.data={...s.data,bikes:[{id:'bike',internalNumber:'TEST-01',plate:'PLATE',status:'working'}],policies:[{id:'policy',number:'TEST-POLICY',company:'Test',wholeFleet:true,expiresOn:'2026-11-15'}],assignments:[{id:'old',bikeId:'bike',bikerId:'worker',bikerName:'اسم محفوظ',receivedOn:'2026-10-01',returnedOn:'2026-10-15'}]};
  mocks.read.mockReturnValue(s);render(<FleetPage/>);expect(screen.getByText(/1 دباب متاح بدون بايكر، و1 بايكر خامل/)).toBeTruthy();expect(screen.getByText(/تنتهي خلال 19 يوم/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'التسليم'}));expect(screen.getByText('اسم محفوظ')).toBeTruthy();expect(screen.getByText('2026-10-15')).toBeTruthy();expect(mocks.save).not.toHaveBeenCalled();
});
it('accountants have read-only registers and no mutation forms',()=>{
  mocks.view.role='accountant';const s=state();s.canEdit=false;mocks.read.mockReturnValue(s);render(<FleetPage/>);expect(screen.queryByRole('form')).toBeNull();expect(screen.queryByRole('button',{name:/^حفظ/})).toBeNull();
});
it('does not turn failed reads into zero available bikes',()=>{
  mocks.read.mockReturnValue({...state(),data:null,error:Error('failed')});render(<FleetPage/>);expect(screen.getByRole('alert').textContent).toContain('الأعداد غير مؤكدة');expect(screen.queryByRole('form')).toBeNull();
});
it('uploads a CSV as a preview only until the owner explicitly confirms its rows',async()=>{
  render(<FleetPage/>);fireEvent.click(screen.getByRole('tab',{name:'تعبئة السجل'}));
  const content=FLEET_CSV_COLUMNS.join(',')+'\nREAL-CSV,ABC,,,,working,,';const file=new File([content],'fleet.csv',{type:'text/csv'});file.text=async()=>content;
  fireEvent.change(screen.getByLabelText('رفع ملف الدبابات'),{target:{files:[file]}});
  await waitFor(()=>expect(screen.getByText('REAL-CSV')).toBeTruthy());expect(mocks.save).not.toHaveBeenCalled();
  const save=screen.getByRole('button',{name:'حفظ الدبابات المراجَعة (1)'});expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox',{name:/راجعت 1 صفًا/}));fireEvent.click(save);
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith({kind:'bike',expectedRevision:0,data:{internalNumber:'REAL-CSV',plate:'ABC',model:'',purchasedOn:'',startupItemId:'',status:'working',statusSince:'',policyId:''}},{refresh:false}));
});
