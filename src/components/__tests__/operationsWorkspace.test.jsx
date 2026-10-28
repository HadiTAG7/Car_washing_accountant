// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import OperationsWorkspacePage,{OperationsChecks} from '../OperationsWorkspacePage';
import OperationsReadinessBanner from '../OperationsReadinessBanner';
const state=vi.hoisted(()=>({role:'admin',isPartnerView:false,read:vi.fn()}));
vi.mock('../../contexts/PartnerViewContext',()=>({usePartnerView:()=>state}));
vi.mock('../../hooks/useOperationsWorkspace',()=>({useOperationsWorkspace:state.read}));
vi.mock('../TopBar',()=>({default:({title})=><h1>{title}</h1>}));
afterEach(()=>{cleanup();state.read.mockClear();state.role='admin';state.isPartnerView=false;});
it.each([['admin',true],['partner',false],['supervisor',false]])('never mounts company data for role %s with partner preview %s',(role,isPartnerView)=>{
  state.role=role;state.isPartnerView=isPartnerView;render(<OperationsWorkspacePage/>);expect(state.read).not.toHaveBeenCalled();
});
it.each(['partner','supervisor','accountant'])('readiness link does not mount company sources for %s',role=>{
  state.role=role;render(<OperationsReadinessBanner periodKey="2026-10"/>);
  expect(state.read).not.toHaveBeenCalled();expect(screen.getByRole('link').getAttribute('href')).toBe('?page=operations_close&period=2026-10');
});
it('shows the same read-only readiness condition without approval or close buttons',()=>{
  state.read.mockReturnValue({loading:false,error:null,value:{ready:false,failedCount:7}});
  render(<OperationsReadinessBanner periodKey="2026-10"/>);
  expect(screen.getByRole('link').textContent).toContain('غير جاهز: 7 بنود');expect(screen.queryByRole('button')).toBeNull();
});
it('renders failed/unknown checks as links without any business write button',()=>{
  render(<OperationsChecks value={{ready:false,failedCount:1,checks:[{id:'x',label:'الأسطول محدّث',ok:false,count:null,href:'?page=fleet'}]}}/>);
  expect(screen.getByText('غير جاهز: 1 بنود')).toBeTruthy();expect(screen.getByRole('link').getAttribute('href')).toBe('?page=fleet');
  expect(screen.queryByRole('button')).toBeNull();expect(screen.getByRole('link').textContent).toContain('غير متاح');
});
