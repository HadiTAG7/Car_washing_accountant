// Isolated storage only. Exact approved identifiers exercise the bounded grant;
// every stored person, receipt and transaction below is synthetic, not production.
import scope from '../src/sweater/recentOwnerRecovery20261102.json' with {type:'json'};
import { normalizeRecord, hashRecord } from '../src/sweater/record.js';
import { COL, rawDocId, sspWashDocId } from '../src/sweater/ingest.js';
export function recentRecoveryFixture(serviceDay='2026-11-01', numbers=null) {
  const targets=scope.rows.filter(row=>row.record.serviceDate===serviceDay&&(!numbers||numbers.includes(row.bookingNumber)));
  const records=targets.map(row=>structuredClone(row.record));
  const payload={kind:'owner_administrative_completion_v1',importRunId:`synthetic-recent-owner-${serviceDay}`,records,
    workerLinks:Object.fromEntries(targets.map(row=>[row.record.driverExternalId,row.workerId])),
    coverage:{rangeFrom:serviceDay,rangeTo:serviceDay,extractedAt:scope.sourceCut,pageCount:1,pagesFetched:1,recordCount:records.length,isComplete:false,
      scope:'explicit_owner_bookings',scopeComplete:true,sourceUrl:records[0].sourceUrl},
    decision:{source:'owner_statement',ownerName:'Synthetic owner',statement:scope.authority.statement,conversationId:scope.authority.conversationId,
      messageId:scope.authority.messageId,decidedAt:scope.authority.requestReceivedAtUtc,decidedAtBasis:'request_received_at',approved:true,
      decision:'record_as_completed_wash',serviceDate:serviceDay,bookingIds:records.map(row=>row.sspBookingId),excludedBookingIds:[]}};
  const seed={'users/admin':{role:'admin'},'users/partner':{role:'partner'},'users/operator':{role:'operator'},[`accounting_periods/${serviceDay.slice(0,7)}`]:{status:'open'}};
  for(const target of targets){
    const {record:current,bookingNumber:number,workerId}=target;
    seed[`bikers/${workerId}`]={name:'Synthetic worker',driver_external_id:current.driverExternalId,start_date:'2026-08-01'};
    const firstId=`B-${number}`,firstRun=`synthetic-first-${number}`,lastRun=`synthetic-last-${number}`;
    const first=normalizeRecord({...current,sspBookingId:firstId,driverExternalId:'SYNTHETIC-previous-worker',rawStatus:'Initiated',startedAt:null,completedAt:null,
      serviceDate:['5681609','5672394'].includes(number)?'2026-10-30':serviceDay});
    const savedS=['5687884','5672394'].includes(number);
    const last=normalizeRecord({...current,sspBookingId:savedS?current.sspBookingId:firstId,rawStatus:savedS?'Collecting Payment':number==='5687835'?'Reached':'Washing Started',
      completedAt:number==='5687154'||savedS?current.completedAt:null});
    for(const [runId,record] of [[firstRun,first],[lastRun,last]]){
      const sourceHash=hashRecord(record),rawId=rawDocId(runId,record.sspBookingId);
      seed[`${COL.RAW}/${rawId}`]={source:'operations_sync_v2',importRunId:runId,sspBookingId:record.sspBookingId,rawPayload:record,normalizedRecord:record,sourceHash};
      seed[`${COL.RUNS}/${runId}`]={source:'operations_sync_v2',importRunId:runId,status:'completed_with_gaps',coverage:{extractedAt:scope.sourceCut},result:{rows:[{
        sspBookingId:record.sspBookingId,driverExternalId:record.driverExternalId,bookingId:number,bikerId:'SYNTHETIC-original-worker',rawId,sourceHash,
        rawSaved:true,bookingSaved:true,washCreated:false,washId:null,reasonCode:savedS?'protected_existing_record':'execution_not_final'}]}};
    }
    seed[`${COL.BOOKINGS}/${number}`]={sspBookingId:last.sspBookingId,bookingNumber:number,record:last,sourceHash:hashRecord(last),schemaVersion:1,source:'operations_sync_v2',
      lastImportRunId:lastRun,serviceDate:last.serviceDate,periodKey:last.serviceDate.slice(0,7),normalizedStatus:last.normalizedStatus,processingStatus:'needs_review',
      reviewReasonCode:'execution_not_final',recognitionEligibility:null,recognitionReason:null,operationalWorkerId:workerId,updatedAtIso:'SYNTHETIC-ORIGINAL-TIME'};
    seed[`sweater_owner_booking_claims/${number}`]={bookingNumber:number,sspBookingId:firstId,washId:sspWashDocId(firstId),source:'operations_sync_v2',
      importRunId:firstRun,claimedBy:'SYNTHETIC-source',claimedAt:'SYNTHETIC-ORIGINAL-TIME'};
  }
  return {payload,seed,targets};
}
