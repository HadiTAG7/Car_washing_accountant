// @vitest-environment jsdom
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,cleanup,waitFor } from '@testing-library/react';
const state=vi.hoisted(()=>({budgets:[],variables:[],cats:[],annuals:[],annualEntries:[],loading:false,error:null,delete:vi.fn(),canMutate:true}));
vi.mock('../../hooks/useBudgets',()=>({useBudgets:()=>({items:state.budgets,loading:false,error:null,deleteItem:state.delete})}));
vi.mock('../../hooks/useMonthlyExpenses',()=>({useMonthlyExpenses:()=>({items:[],loading:false})}));
vi.mock('../../hooks/useMonthlyExpenseCategories',()=>({useMonthlyExpenseCategories:()=>({categories:[],loading:false})}));
vi.mock('../../hooks/useAnnualExpenses',()=>({useAnnualExpenses:()=>({items:state.annuals,loading:false})}));
vi.mock('../../hooks/useAnnualExpenseCategories',()=>({useAnnualExpenseCategories:()=>({categories:[{id:'a',label:'Rent'}],loading:false})}));
vi.mock('../../hooks/useAnnualExpenseEntries',()=>({useAllAnnualEntries:()=>({entries:state.annualEntries,loading:state.loading,error:state.error})}));
vi.mock('../../hooks/useVariableExpenses',()=>({useVariableExpenses:()=>({items:state.variables,loading:false})}));
vi.mock('../../hooks/useVariableExpenseCategories',()=>({useVariableExpenseCategories:()=>({categories:state.cats,loading:false})}));
vi.mock('../../hooks/useWashes',()=>({useWashes:()=>({items:[],loading:false})}));
vi.mock('../../contexts/PartnerViewContext',()=>({usePartnerView:()=>({scalingFactor:1,canMutate:state.canMutate})}));
vi.mock('../../lib/firebaseClient',()=>({isFirebaseConfigured:true,missingEnvNames:[],describeBackendError:e=>e.message,maskedProjectRef:()=>null}));
vi.mock('../../lib/washesYesterday',()=>({riyadhTodayISO:()=> '2026-10-23'}));
vi.mock('../TopBar',()=>({default:()=>null}));
import BudgetsPage,{BudgetCard} from '../BudgetsPage';
import {formatCurrencyPrecise} from '../../data/initialData';
beforeEach(()=>{vi.clearAllMocks();state.budgets=[];state.variables=[];state.cats=[];state.annuals=[];state.annualEntries=[];state.loading=false;state.error=null;state.canMutate=true;});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('unbudgeted spend is neutral, never an overrun or completed budget',()=>{
 render(<BudgetCard budget={{id:'v',categoryLabel:'Fuel'}} allocated={0} spent={200} canMutate={false}/>);
 expect(screen.getAllByText('ما انحددت ميزانية').length).toBeGreaterThan(0);expect(screen.queryByText('تجاوز الميزانية')).toBeNull();expect(screen.queryByText('اكتملت الميزانية')).toBeNull();
});
it('completes a budget only when actual paid reaches the allocated amount',()=>{
 const props={budget:{id:'a',budgetType:'annual',categoryLabel:'Rent'},allocated:180000,spent:74100,commitment:180000,dueToDate:135000,canMutate:false};
 const {rerender}=render(<BudgetCard {...props}/>);expect(screen.queryByText('اكتملت الميزانية')).toBeNull();
 rerender(<BudgetCard {...props} spent={180000}/>);expect(screen.getByText('اكتملت الميزانية')).toBeTruthy();
});
it('disables delete/hide buttons when any registered expense exists',()=>{
 render(<BudgetCard budget={{id:'b',categoryLabel:'Fuel'}} allocated={100} spent={0} hasExpenses canMutate/>);
 expect(screen.getByRole('button',{name:'حذف Fuel'}).disabled).toBe(true);
});
it('requires confirmation for an unused saved budget, cancelling leaves it intact',async()=>{
 state.budgets=[{id:'b',categoryLabel:'Empty',budgetType:'monthly',amount:100}];const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 render(<BudgetsPage/>);fireEvent.click(screen.getByRole('button',{name:'حذف Empty'}));expect(confirm).toHaveBeenCalledTimes(1);expect(state.delete).not.toHaveBeenCalled();
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'حذف Empty'}));await waitFor(()=>expect(state.delete).toHaveBeenCalledWith('b'));
});
it('selects months without a write and separates annual payment figures from the chosen month',()=>{
 state.canMutate=false;state.cats=[{id:'f',label:'Fuel'}];state.variables=[{categoryId:'f',loggedDate:'2026-10-01',totalVariableCost:30},{categoryId:'f',loggedDate:'2026-09-01',totalVariableCost:20}];
 state.annuals=[{id:'p',category:'a',expenseName:'Housing',annualCost:180000}];state.annualEntries=[{annualExpenseId:'p',amount:74100,spentDate:'2026-09-01'}];
 render(<BudgetsPage/>);expect(screen.getByLabelText('هذا الشهر').textContent).toContain(formatCurrencyPrecise(30));
 fireEvent.change(screen.getByLabelText('شهر الميزانيات الشهرية'),{target:{value:'2026-09'}});
 expect(screen.getByLabelText('هذا الشهر').textContent).toContain(formatCurrencyPrecise(20));expect(screen.getByLabelText('هذه السنة').textContent).toContain(formatCurrencyPrecise(74100));expect(state.delete).not.toHaveBeenCalled();
});
it('does not show a zero paid figure while annual payments are loading or unavailable',()=>{
 state.loading=true;const {rerender}=render(<BudgetsPage/>);expect(screen.queryByLabelText('هذه السنة')).toBeNull();
 state.loading=false;state.error=Error('Annual read failed');rerender(<BudgetsPage/>);expect(screen.queryByLabelText('هذه السنة')).toBeNull();expect(screen.getByText('تعذّر تحميل بيانات الميزانية كاملة')).toBeTruthy();
});
