import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { useOverviewDashboard } from './useOverviewDashboard';
import { useIdleBikersData } from './useIdleBikersData';
import { useSweaterFreshness } from './useSweaterFreshness';
import { useFirestoreQuery } from './useFirestoreQuery';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, getRow, where } from '../lib/firestoreCrud';
import { mapStartupCost, mapStartupCostEntry, mapAnnualExpense, mapAnnualExpenseEntry, mapHousingUnit } from '../lib/mappers';
import { operationsWorkspace } from '../lib/operationsWorkspace';
import { riyadhToday } from '../lib/bikerProfile';
import { isBikerDeduction } from '../lib/sweater/bikerDeductions';
const names=['startup_costs','startup_cost_entries','annual_expenses','annual_expense_entries','housing_units','fleet_bikes','fleet_maintenance','fleet_policies'];
export function useOperationsWorkspace(periodKey) {
  const { user }=useAuth(),today=riyadhToday();
  const overview=useOverviewDashboard(periodKey,today);
  const idle=useIdleBikersData(overview,{periodKey,today});
  const freshness=useSweaterFreshness();
  const resources=useFirestoreQuery(async()=>{
    const [rows,objections,qualitySettings,bookings]=await Promise.all([
      Promise.all(names.map(name=>fetchRows(name))),fetchRows('quality_objections',[where('periodKey','==',periodKey)]),
      getRow('app_settings','quality-objections'),fetchRows('sweater_bookings',[where('periodKey','==',periodKey)]),
    ]);
    return {startup:rows[0].map(mapStartupCost),startupEntries:rows[1].map(mapStartupCostEntry),annual:rows[2].map(mapAnnualExpense),
      annualEntries:rows[3].map(mapAnnualExpenseEntry),housing:rows[4].map(mapHousingUnit),bikes:rows[5],maintenance:rows[6],policies:rows[7],objections:objections.filter(row=>!isBikerDeduction(row)),qualitySettings,bookings};
  },{enabled:isFirebaseConfigured&&Boolean(user?.id),preserveResult:true,cacheKey:`operationsWorkspace:${periodKey}`,cacheTags:[...names,'quality_objections','app_settings','sweater_bookings'],queryKey:user?.id,deps:[periodKey],fallback:null});
  const states=[overview.washes,overview.workers,overview.finance,overview.payroll,idle,overview.sweaterMetrics,resources,freshness];
  const loading=states.some(s=>s.loading),error=states.find(s=>s.error)?.error;
  const value=useMemo(()=>operationsWorkspace({periodKey,today,
    ops:overview.washes.loading||overview.washes.error?null:overview.operations,
    bikers:overview.workers.loading||overview.workers.error?null:overview.workers.bikers,washes:overview.washes.items,
    statement:overview.finance.statement,payrollLines:overview.payroll.data?.find(p=>p.periodKey===periodKey&&!p.unavailable)?.lines,
    idle:idle.loading||idle.error?null:idle.value,snapshot:overview.sweaterMetrics.loading||overview.sweaterMetrics.error?null:overview.sweaterMetrics.snapshot,
    resources:resources.loading||resources.error?null:resources.data,bookings:resources.loading||resources.error?null:resources.data?.bookings,
    freshness:freshness.value,
  }),[periodKey,today,overview,idle,resources,freshness.value]);
  return {value,loading,error,freshness,retry:()=>{overview.retry();idle.retry();resources.refetch();freshness.refetch();}};
}
