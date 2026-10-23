// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ error:null, loading:false, declarationsError:null, scale:1, reads:vi.fn() }));
vi.mock('../../hooks/useTaxInvoices',()=>({useTaxInvoices:options=>{state.reads(options);return { invoices:[{id:'i',source:'variable',sourceKind:'variable',amount:115,isTaxInvoice:true,invoiceNumber:'INV',invoiceDate:'2026-10-02',supplier:'مورد',vatAmount:15}], loading:false,error:null,sourceErrors:{},coverage:{loading:state.loading,error:state.error},refetch:vi.fn() };}}));
vi.mock('../../hooks/useStartupCosts',()=>({useStartupCosts:()=>({items:[]})}));
vi.mock('../../hooks/useAnnualExpenses',()=>({useAnnualExpenses:()=>({items:[]})}));
vi.mock('../../hooks/useMonthlyExpenses',()=>({useMonthlyExpenses:()=>({items:[]})}));
vi.mock('../../hooks/useVariableExpenses',()=>({useVariableExpenses:()=>({items:[]})}));
vi.mock('../../hooks/useWashes',()=>({useWashes:()=>({items:[{id:'w',quantity:1,price:20,priceMode:'exclusive',status:'مكتملة',washDate:'2026-10-20'}],loading:false,error:null})}));
vi.mock('../../hooks/useLedger',()=>({useLedger:()=>({entries:[],lines:[],loading:false,error:null})}));
vi.mock('../../hooks/useAccountingSettings',()=>({useAccountingSettings:()=>({settings:{vatFilingPeriod:'quarterly',vatRegistered:true,taxPolicyHistory:[{effectiveFrom:'2026-05-01',vatRegistered:true,vatRate:.15,washPriceMode:'exclusive'}]},loading:false,error:null})}));
vi.mock('../../hooks/useSweater',()=>({useSweaterSettlements:()=>({settlements:[],loading:false,error:null})}));
vi.mock('../../hooks/useVatDeclarations',()=>({useVatDeclarations:()=>({declarations:[],loading:false,error:state.declarationsError})}));
vi.mock('../../hooks/useFirestoreQuery',()=>({useFirestoreQuery:()=>({data:{vatRegistered:false},loading:false,error:null})}));
vi.mock('../../lib/accounting/firestoreInvoicing',()=>({fetchSellerProfile:vi.fn()}));
vi.mock('../../contexts/PartnerViewContext',()=>({usePartnerView:()=>({scalingFactor:state.scale})}));
vi.mock('../../lib/firebaseClient',()=>({isFirebaseConfigured:true,missingEnvNames:[],describeBackendError:e=>e.message,maskedProjectRef:()=>null}));
vi.mock('../TopBar',()=>({default:()=>null}));
vi.mock('../../lib/accounting/vatDashboard',async original=>({...await original(),riyadhDay:()=> '2026-10-23'}));
import VatRecoveryPage from '../VatRecoveryPage';
import VatDeclarations from '../vat/VatDeclarations';
import { formatCurrencyPrecise } from '../../data/initialData';
beforeEach(()=>{vi.clearAllMocks();state.error=null;state.loading=false;state.declarationsError=null;state.scale=1;});
afterEach(cleanup);
describe('VAT page display/read coverage',()=>{
 it('opens on the current quarter, always shows both output bases, and changes all headline cards together',()=>{
   render(<VatRecoveryPage/>);
   expect(screen.getByLabelText('فترة الضريبة').value).toBe('2026-Q4');
   expect(state.reads).toHaveBeenCalledWith({includeNonTax:true});
   expect(screen.getByText('المخرجات المرحّلة (2100)')).toBeTruthy();
   expect(screen.getByText('تعارض التسجيل:',{exact:false})).toBeTruthy();
   const card=screen.getByText('ضريبة المخرجات (المبيعات)').closest('.sw-stat-card');
   expect(card.querySelector('.sw-stat-value').textContent).toBe(formatCurrencyPrecise(3));
   fireEvent.change(screen.getByLabelText('فترة الضريبة'),{target:{value:'2026-Q3'}});
   expect(card.querySelector('.sw-stat-value').textContent).toBe(formatCurrencyPrecise(0));
   expect(screen.getByText('المخرجات المرحّلة (2100)')).toBeTruthy();
 });
 it('does not show partial totals after a source failure',()=>{
   state.error=Error('source unavailable');render(<VatRecoveryPage/>);
   expect(screen.getByText('بيانات الضريبة غير مكتملة؛ لم نعرض إجماليات جزئية')).toBeTruthy();
   expect(screen.queryByText('صافي الضريبة المستردة')).toBeNull();
 });
 it('does not show zero totals while loading',()=>{
   state.loading=true;render(<VatRecoveryPage/>);expect(screen.queryByText('ضريبة المدخلات المؤهلة')).toBeNull();
 });
 it('shows an unreadable declaration table as unknown, not unsubmitted',()=>{
   state.declarationsError=Error('missing migration');render(<VatRecoveryPage/>);
   expect(screen.getByText('تعذّر قراءة سجل الإقرارات؛ حالة التقديم غير متحققة.')).toBeTruthy();
   expect(screen.queryByText(/باقي 8 يوم/)).toBeNull();
 });
 it('scales both operational and ledger comparisons consistently',()=>{
   state.scale=.5;render(<VatRecoveryPage/>);
   expect(screen.getByText('ضريبة المخرجات (المبيعات)').closest('.sw-stat-card').querySelector('.sw-stat-value').textContent).toBe(formatCurrencyPrecise(1.5));
 });
 it('shows quarter 3 deadline in red and does not turn absent evidence into proof of filing',()=>{
   render(<VatRecoveryPage/>);
   expect(screen.getByText(/باقي 8 يوم/).className).toContain('text-red');
   expect(screen.getAllByText(/لا يوجد إثبات تقديم مسجّل/)).toHaveLength(2);
 });
 it('rejects unsafe evidence URLs and has no filing/payment buttons',()=>{
   render(<VatDeclarations rows={[{period:'2026-Q3',report:{input:{tax:20},output:{tax:0},netTax:-20}}]} records={[{periodKey:'2026-Q3',status:'submitted',submittedDate:'2026-10-20',evidenceUrl:'javascript:alert(1)'}]} today="2026-10-23"/>);
   expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByRole('button')).toBeNull(); expect(screen.getByText('مقدّم')).toBeTruthy();
 });
 it('distinguishes missing tracking evidence from an explicitly unsubmitted return',()=>{
   render(<VatDeclarations rows={['2026-Q2','2026-Q3'].map(period=>({period,report:{input:{tax:0},output:{tax:0},netTax:0}}))}
     records={[{periodKey:'2026-Q3',status:'not_submitted'}]} today="2026-10-23"/>);
   expect(screen.getByText('حالة التقديم غير متحققة — لا إثبات مسجّل')).toBeTruthy();
   expect(screen.getByText('لم يُقدَّم')).toBeTruthy();
   expect(screen.getByText(/انقضى الموعد منذ 84 يوم/)).toBeTruthy();
   expect(screen.queryByText(/متأخر 84 يوم/)).toBeNull();
 });
});
