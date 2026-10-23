const params=new URLSearchParams(window.location.search);
export const describeBackendError=e=>e.message;
export const maskedProjectRef=()=>null;
export const useSweaterWashDetails=()=>({bookings:[],loading:false,error:null});
export const callSweaterImportPreview=async()=>{throw new Error('Legacy handoff is outside this synthetic fixture');};
export const callSweaterOwnerHandoffSave=callSweaterImportPreview;
let result;
export const callSweaterAdministrativeCompletionPreview=async p=>{
  if(params.get('role')==='accountant')throw new Error('Admin role required — synthetic refusal');
  result={canSave:true,administrativeDecision:p.decision,reviewedPayloadHash:'synthetic-file-hash',previewStateHash:'synthetic-state-hash',
    counts:{new:4,modified:0,duplicate:0,rejected:0,needsReview:0},rows:p.records.map(r=>({...r,outcome:'new',bikerName:'Synthetic worker',collectionStatus:'pending'}))};return result;
};
export const callSweaterAdministrativeCompletionSave=async request=>{
  document.getElementById('fixture-action').textContent=`Synthetic save only — ${request.reviewedPayloadHash} — ${request.previewStateHash}`;
  return {...result,saved:true,washesCreated:4};
};
