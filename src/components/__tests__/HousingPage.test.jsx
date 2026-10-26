// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react';
const mocks=vi.hoisted(()=>({states:{},view:{role:'admin',canMutate:true},update:vi.fn(),refs:Array.from({length:6},()=>vi.fn())}));
vi.mock('../../hooks/useBikers',()=>({useBikers:()=>mocks.states.bikers}));
vi.mock('../../hooks/useStartupCosts',()=>({useStartupCosts:()=>mocks.states.startup}));
vi.mock('../../hooks/useStartupCostEntries',()=>({useAllStartupEntries:()=>mocks.states.setup}));
vi.mock('../../hooks/useAnnualExpenses',()=>({useAnnualExpenses:()=>mocks.states.annual}));
vi.mock('../../hooks/useAnnualExpenseEntries',()=>({useAllAnnualEntries:()=>mocks.states.rent}));
vi.mock('../../hooks/useHousingUnits',()=>({useHousingUnits:()=>mocks.states.meta}));
vi.mock('../../contexts/PartnerViewContext',()=>({usePartnerView:()=>mocks.view}));
vi.mock('../../i18n/useLanguage',()=>({useLanguage:()=>({language:'ar'})}));
vi.mock('../../lib/bikerProfile',()=>({riyadhToday:()=> '2026-10-27'}));
vi.mock('../TopBar',()=>({default:()=>null}));
vi.mock('../EditHousingUnitModal',()=>({default:()=>null}));
import HousingPage from '../HousingPage';
beforeEach(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  mocks.view={role:'admin',canMutate:true};mocks.update.mockResolvedValue({});
  const bikers=[{id:'active',name:'عامل نشط',residence:'سكن الشمال'},{id:'ended',name:'عامل انتهى',residence:'سكن الشمال',endDate:'2026-10-26'}];
  mocks.states={bikers:{bikers,refetch:mocks.refs[0],updateBiker:mocks.update},startup:{items:[{id:'s',units:['سكن الشمال'],quantity:2}],refetch:mocks.refs[1]},setup:{entries:[],refetch:mocks.refs[2]},annual:{items:[],refetch:mocks.refs[3]},rent:{entries:[],refetch:mocks.refs[4]},meta:{metaRows:[{name:'سكن الشمال',capacity:3}],refetch:mocks.refs[5]}};
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('shows the eviction proposal after an end date without writing, and cancel keeps the resident',()=>{
  render(<HousingPage/>);expect(screen.getAllByText('يحتاج إخلاء').length).toBeGreaterThan(0);
  expect(screen.getByRole('link',{name:'عامل انتهى'}).getAttribute('href')).toBe('?page=bikers&bikerId=ended');
  fireEvent.click(screen.getByRole('button',{name:'مراجعة اقتراح الإخلاء'}));
  const dialog=screen.getByRole('dialog');expect(within(dialog).getByRole('button',{name:'تأكيد تغيير السكن'}).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole('button',{name:'إلغاء دون تغيير'}));expect(mocks.update).not.toHaveBeenCalled();expect(screen.getByRole('link',{name:'عامل انتهى'})).toBeTruthy();
});
it('only invokes the existing biker update after explicit owner confirmation',async()=>{
  render(<HousingPage/>);fireEvent.click(screen.getByRole('button',{name:'مراجعة اقتراح الإخلاء'}));const dialog=screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));fireEvent.click(within(dialog).getByRole('button',{name:'تأكيد تغيير السكن'}));
  await waitFor(()=>expect(mocks.update).toHaveBeenCalledExactlyOnceWith('ended',{residence:''}));
});
it('rejects a stale proposal when the resident has already moved elsewhere',()=>{
  const page=render(<HousingPage/>);fireEvent.click(screen.getByRole('button',{name:'مراجعة اقتراح الإخلاء'}));
  mocks.states.bikers={...mocks.states.bikers,bikers:mocks.states.bikers.bikers.map(b=>b.id==='ended'?{...b,residence:'سكن آخر'}:b)};page.rerender(<HousingPage/>);
  const dialog=screen.getByRole('dialog');fireEvent.click(within(dialog).getByRole('checkbox'));fireEvent.click(within(dialog).getByRole('button',{name:'تأكيد تغيير السكن'}));
  expect(within(dialog).getByRole('alert').textContent).toContain('تغير سكن البايكر');expect(mocks.update).not.toHaveBeenCalled();
});
it('keeps existing metadata editing for accountants while reserving move-out confirmation to admin',()=>{
  mocks.view={role:'accountant',canMutate:true};render(<HousingPage/>);expect(screen.queryByRole('button',{name:'مراجعة اقتراح الإخلاء'})).toBeNull();expect(screen.getByRole('button',{name:'تعديل بيانات سكن الشمال'})).toBeTruthy();expect(mocks.update).not.toHaveBeenCalled();
});
it('does not show successful zero figures when rental reads fail or are pending',()=>{
  mocks.states.rent.error=Error('read failed');const page=render(<HousingPage/>);expect(screen.queryByText('الساكنون النشطون')).toBeNull();
  mocks.states.rent={entries:[],loading:true};page.rerender(<HousingPage/>);expect(screen.getByText('جارٍ تحميل بيانات السكن...')).toBeTruthy();expect(screen.queryByText('الساكنون النشطون')).toBeNull();
});
it('refreshes every source including the biker roster and annual entries',()=>{
  render(<HousingPage/>);fireEvent.click(screen.getByRole('button',{name:'تحديث البيانات'}));for(const fn of mocks.refs)expect(fn).toHaveBeenCalledOnce();
});
