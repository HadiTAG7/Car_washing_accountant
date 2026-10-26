export function operationsSnapshotSeed(){
  const seed={'users/test-admin':{role:'admin'},'payroll_periods/2026-10':{currentRunId:'approved'},'payroll_runs/approved':{periodKey:'2026-10',status:'approved',estimated:false,totals:{}},
    'sweater_metric_snapshots/month':{periodKey:'2026-10',extractedAtIso:'2026-10-26T19:00:00+03:00',metrics:{completedWashes:7,cancelledByBiker:4}}};
  for(const id of ['a','b']){seed[`bikers/${id}`]={name:id,start_date:'2026-10-01',current_status:'شغال'};seed[`payroll_runs/approved/items/${id}`]={bikerId:id,basicDue:900,bonus:0,deduction:0,daysEntitled:31,eligibleStart:'2026-10-01',eligibleEnd:'2026-10-31'};}
  for(const [id,date] of [['one','2026-10-25'],['two','2026-10-25'],['three','2026-10-26'],['four','2026-10-26'],['five','2026-10-26']]){
    seed[`washes/${id}`]={wash_date:date,biker_id:'a',ssp_booking_id:id,status:'completed',quantity:1};
    seed[`sweater_bookings/${id}`]={record:{sspBookingId:id,serviceDate:date,completedAt:`${date}T12:00:00+03:00`}};
  }return seed;
}
