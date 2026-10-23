/* eslint-disable react-refresh/only-export-components -- isolated, read-only test adapters */
const invoice = { id:'synthetic-tax',source:'variable',sourceKind:'variable',amount:1863.62,invoiceDate:'2026-10-18',invoiceNumber:'DEMO-ONLY',isTaxInvoice:true,supplier:'مورّد اختبار',vatAmount:243.08,description:'فاتورة اختبار فقط' };
export const useTaxInvoices = () => ({ invoices:[invoice,{id:'synthetic-non-tax',source:'variable',sourceKind:'variable',amount:40,isTaxInvoice:false,supplier:'مورّد اختبار',spentDate:'2026-10-18',description:'إيصال يحتاج فاتورة ضريبية'}], loading:false,error:null,sourceErrors:{},coverage:{loading:false,error:null},refetch:()=>{} });
export const useStartupCosts = () => ({items:[]});
export const useAnnualExpenses = () => ({items:[]});
export const useMonthlyExpenses = () => ({items:[]});
export const useVariableExpenses = () => ({items:[]});
export const useWashes = () => ({items:Array.from({length:424},(_,i)=>({id:`demo-${i}`,status:'مكتملة',quantity:1,price:20,washDate:'2026-10-21',priceMode:'exclusive'})),loading:false,error:null});
export const useLedger = () => ({entries:[],lines:[],loading:false,error:null});
export const useAccountingSettings = () => ({settings:{vatFilingPeriod:'quarterly',vatRegistered:true,taxPolicyHistory:[{effectiveFrom:'2026-04-30',vatRegistered:false,vatRate:.15,washPriceMode:'inclusive'},{effectiveFrom:'2026-05-01',vatRegistered:true,vatRate:.15,washPriceMode:'exclusive'}]},loading:false,error:null});
export const useSweaterSettlements = () => ({settlements:[],loading:false,error:null});
export const useVatDeclarations = () => ({declarations:[],loading:false,error:null});
export const useFirestoreQuery = () => ({data:{vatRegistered:false},loading:false,error:null});
export const fetchSellerProfile = () => {throw Error('Backend access disabled in this synthetic preview');};
export const usePartnerView = () => ({role:'admin',scalingFactor:1});
export const isFirebaseConfigured = true,missingEnvNames=[];
export const describeBackendError = error => error.message;
export const maskedProjectRef = () => null;
export default function PreviewTopBar({title}) {return <header className="p-5 text-xl font-bold">{title}</header>;}
