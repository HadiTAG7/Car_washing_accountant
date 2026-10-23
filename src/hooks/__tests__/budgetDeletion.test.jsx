// @vitest-environment jsdom
import {renderHook,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({expense:false,readError:false,deleted:vi.fn()}));
vi.mock('../../lib/firebaseClient',()=>({isFirebaseConfigured:true}));
vi.mock('../useFirestoreQuery',()=>({useFirestoreQuery:()=>({data:[],loading:false,refetch:vi.fn()})}));
vi.mock('../../lib/firestoreCrud',()=>({getRow:vi.fn(async()=>({id:'b',category_label:'Fuel',budget_type:'monthly',amount:100})),
 fetchRows:vi.fn(async path=>{if(state.readError)throw Error('read failed');if(path==='variable_expense_categories')return [{id:'fuel',label:'Fuel'}];if(path==='variable_expenses'&&state.expense)return [{id:'old',category_id:'fuel',total_variable_cost:20,logged_date:'2026-05-01'}];return [];}),
 deleteRow:state.deleted,insertRow:vi.fn(),updateRow:vi.fn(),sortBy:rows=>rows}));
import {useBudgets} from '../useBudgets';
beforeEach(()=>{state.expense=false;state.readError=false;vi.clearAllMocks();});afterEach(cleanup);
it('fresh deletion check blocks an expense added after the page loaded, including historical spend',async()=>{
 const {result}=renderHook(()=>useBudgets());state.expense=true;await expect(result.current.deleteItem('b')).rejects.toThrow('مصاريف مسجلة');expect(state.deleted).not.toHaveBeenCalled();
});
it('fails closed when a source cannot be checked',async()=>{
 state.readError=true;const {result}=renderHook(()=>useBudgets());await expect(result.current.deleteItem('b')).rejects.toThrow('read failed');expect(state.deleted).not.toHaveBeenCalled();
});
it('uses only the existing budget delete path when no expense exists',async()=>{
 const {result}=renderHook(()=>useBudgets());await result.current.deleteItem('b');expect(state.deleted).toHaveBeenCalledWith('category_budgets','b');
});
