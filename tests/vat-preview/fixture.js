// Synthetic read-only data; no SDK, session, API requests or business writes.
export const ready = data => ({ data, loading: false, error: null });
export const settings = { vatRegistered: true, vatRate: .15, washPriceMode: 'inclusive', vatFilingPeriod: 'quarterly', taxPolicyHistory: [{ effectiveFrom: '2026-05-01', vatRegistered: true, vatRate: .15, washPriceMode: 'inclusive' }] };
export const useTaxInvoices = () => ({ ...ready(), sourceErrors: {}, coverage: {loading:false,error:null}, invoices: [
  { id: 'test-good', sourceKind: 'variable', source:'variable', invoiceDate: '2026-10-01', invoiceNumber:'TEST-1', supplier:'مورد اختبار', amount:115, isTaxInvoice:true, vatDeductible:true, priceMode:'inclusive', vatAmount:15 },
  { id:'test-gap', sourceKind:'variable', source:'variable', invoiceDate:'2026-10-02', supplier:'مورد اختبار', amount:230, isTaxInvoice:true, vatAmount:30 },
  { id:'test-no-date', sourceKind:'variable', source:'variable', supplier:'مورد بلا تاريخ', amount:115, isTaxInvoice:true, vatAmount:15 },
], refetch:()=>{} });
export const useWashes = () => ({ ...ready(), items:[{id:'test-wash',washDate:'2026-10-01',status:'مكتملة',quantity:1,price:23,revenueOrigin:'sweater'}] });
export const useLedger = () => ({ ...ready(), entries:[{id:'test-entry',entryDate:'2026-10-02',status:'posted'}],lines:[{entryId:'test-entry',accountId:'2100',debit:0,credit:1}] });
export const useAccountingSettings = () => ({ ...ready(), settings });
export const useSweaterSettlements = () => ({ ...ready(), settlements:[] });
export const useFirestoreQuery = () => ready({name:'',vatNumber:'',address:'',vatRegistered:false});
export const useFinanceRead = () => ({...ready({report:{reportId:'finance-2026-10-24-3-weekly-2026-10-18-2026-10-24',sourceRole:3,dateRiyadh:'2026-10-24',visibleWarnings:[{id:'historical-q3',text:'مرجع 65011830763'}],cases:[{caseId:'TAX-Q3-FILED-CREDIT-PRESENTATION-20261015'}]}}),allowed:true});
export const usePartnerView = () => ({role:'admin',canMutate:false,isPartnerView:false,scalingFactor:1});
export const useItems = () => ({...ready(),items:[]});
export const isFirebaseConfigured = true, missingEnvNames=[];
export const fetchSellerProfile = () => {throw new Error('Isolated fixture: no SDK reads');};
