/* eslint-disable react-refresh/only-export-components -- isolated synthetic adapters */
const noWrite=async()=>{throw Error('Synthetic preview: writes disabled');};
const base={loading:false,error:null,refetch:()=>{}};
export const useBudgets=()=>({...base,items:[{id:'demo-other',categoryLabel:'أخرى',budgetType:'monthly',amount:5000},{id:'demo-rent',categoryLabel:'سكن العمال',budgetType:'annual',amount:180000}],addItem:noWrite,updateItem:noWrite,deleteItem:noWrite});
export const useMonthlyExpenses=()=>({...base,items:[{id:'demo-phone',categoryId:'phone',totalMonthlyCost:43.58,recurrence:'one_time',loggedDate:'2026-10-07'}]});
export const useMonthlyExpenseCategories=()=>({...base,categories:[{id:'phone',label:'اتصالات'}]});
export const useVariableExpenseCategories=()=>({...base,categories:[{id:'legacy',label:'عمولات البايكرز'},{id:'dynamic',label:'عمولات البايكرز والموزعين',isDynamic:true},{id:'fuel',label:'وقود وإمدادات إضافية'},{id:'unused',label:'بند بلا مصروف'}]});
export const useVariableExpenses=()=>({...base,items:[{id:'demo-fuel',categoryId:'fuel',totalVariableCost:598.54,loggedDate:'2026-10-04'},{id:'demo-old',categoryId:'fuel',totalVariableCost:100,loggedDate:'2026-09-04'}]});
export const useAnnualExpenseCategories=()=>({...base,categories:[{id:'rent',label:'سكن العمال'},{id:'gov',label:'تراخيص ورسوم حكومية'},{id:'workers',label:'تأمين العمال'}]});
export const useAnnualExpenses=()=>({...base,items:[{id:'rent-plan',category:'rent',expenseName:'سكن اختبار',annualCost:180000},{id:'tamm-plan',category:'gov',expenseName:'اشتراك تم',annualCost:2070,paymentStatus:'paid'}]});
export const useAllAnnualEntries=()=>({...base,entries:[{id:'demo-paid',annualExpenseId:'rent-plan',amount:74100,spentDate:'2026-09-17'}]});
export const useWashes=()=>({...base,items:[{id:'demo-wash',bikerName:'اختبار',status:'مكتملة',washDate:'2026-10-21',quantity:424,price:20}]});
export const usePartnerView=()=>({canMutate:true,scalingFactor:1,role:'admin'});
export const isFirebaseConfigured=true,missingEnvNames=[];
export const describeBackendError=e=>e.message;
export const maskedProjectRef=()=>null;
export default function PreviewTopBar({title}){return <header className="p-5 text-xl font-bold">{title}</header>;}
