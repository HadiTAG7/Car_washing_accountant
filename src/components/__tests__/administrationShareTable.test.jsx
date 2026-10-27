// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import AdministrationShareTable from '../AdministrationShareTable';
const state=vi.hoisted(()=>({loading:false,error:null,washes:[],entries:[],lines:[],sources:{}}));
vi.mock('../../hooks/useStatementMonths',()=>({useStatementMonths:()=>['2026-08','2026-09','2026-10']}));
vi.mock('../../hooks/useIncomeStatementSources',()=>({useIncomeStatementSources:()=>({...state,sources:{...state.sources,washes:state.washes}})}));
vi.mock('../../hooks/useLedger',()=>({useLedger:()=>({...state,accounts:[{code:'4000',accountType:'revenue',normalBalance:'credit'}]})}));
vi.mock('../../hooks/useAccountingSettings',()=>({useAccountingSettings:()=>({loading:false,settings:{taxPolicyHistory:[{effectiveFrom:'2026-01-01',vatRegistered:false}]}})}));
vi.mock('../../hooks/useIncomePayrollPreviews',()=>({useIncomePayrollPreviews:()=>({loading:false,data:[]})}));
afterEach(()=>{cleanup();state.loading=false;state.error=null;state.washes=[];state.entries=[];state.lines=[];state.sources={};});
it('shows independent positive, loss and zero months without save or paid assertions',()=>{
 state.entries=['08','09'].map(m=>({id:m,entryDate:`2026-${m}-01`,status:'posted'}));
 state.lines=[{entryId:'08',accountId:'4000',credit:10000},{entryId:'09',accountId:'4000',debit:10000}];
 render(<AdministrationShareTable/>);
 expect(screen.getByText('مستحقة حسابيًا · لا يوجد إثبات سداد مربوط')).toBeTruthy();
 expect(screen.getAllByText('لا حصة لهذا الشهر')).toHaveLength(2);
 expect(screen.queryByRole('button')).toBeNull();
 expect(screen.getByText(/1,500/)).toBeTruthy();
});
it('keeps a failed read unavailable instead of reporting a zero share',()=>{
 state.error=new Error('offline');render(<AdministrationShareTable/>);
 expect(screen.getByRole('alert').textContent).toMatch(/لا تُفترض حصة صفر/);
 expect(screen.queryByRole('table')).toBeNull();
});
it('does not treat an excluded unresolved source as a confirmed zero month',()=>{
 state.washes=[{id:'w',wash_date:'2026-10-01',status:'مكتملة',quantity:1,price:20,revenue_origin:'sweater',collection_status:'confirmed_by_owner'}];
 render(<AdministrationShareTable/>);
 expect(screen.getByText('تعذر الحساب')).toBeTruthy();
 expect(screen.getAllByText('غير متاح')).toHaveLength(2);
});
