// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import OperationsWorkspacePage,{OperationsChecks} from '../OperationsWorkspacePage';
const state=vi.hoisted(()=>({role:'admin',isPartnerView:false,read:vi.fn()}));
vi.mock('../../contexts/PartnerViewContext',()=>({usePartnerView:()=>state}));
vi.mock('../../hooks/useOperationsWorkspace',()=>({useOperationsWorkspace:state.read}));
vi.mock('../TopBar',()=>({default:({title})=><h1>{title}</h1>}));
afterEach(()=>{cleanup();state.read.mockClear();state.role='admin';state.isPartnerView=false;});
it('never mounts company data in partner or supervisor mode',()=>{
  state.isPartnerView=true;render(<OperationsWorkspacePage/>);expect(state.read).not.toHaveBeenCalled();
});
it('renders failed/unknown checks as links without any business write button',()=>{
  render(<OperationsChecks value={{ready:false,failedCount:1,checks:[{id:'x',label:'الأسطول محدّث',ok:false,count:null,href:'?page=fleet'}]}}/>);
  expect(screen.getByText('غير جاهز: 1 بنود')).toBeTruthy();expect(screen.getByRole('link').getAttribute('href')).toBe('?page=fleet');
  expect(screen.queryByRole('button')).toBeNull();expect(screen.getByRole('link').textContent).toContain('غير متاح');
});
