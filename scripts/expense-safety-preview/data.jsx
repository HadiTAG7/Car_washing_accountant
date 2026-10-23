/* eslint-disable react-refresh/only-export-components -- isolated test adapters, not a production module */
import { useEffect, useSyncExternalStore } from 'react';
import { mapStartupCost, mapStartupCostEntry, mapAnnualExpense, mapAnnualExpenseEntry, mapTemporaryExpense, mapBiker, mapWash, toAnnualExpenseUpdate } from '../../src/lib/mappers';
let state = { loading: true, rows: {}, audits: [] }, started = false;
const listeners = new Set(), emit = value => { state = value; listeners.forEach(fn => fn()); };
async function api(input) {
  if (location.host !== '127.0.0.1:5206') throw Error('Local-only isolated fixture');
  const response = await fetch('/__expense-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json(); if (!response.ok) throw Error(value.error); emit({ ...value, loading: false }); return value.result;
}
function useData() {
  const data = useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
  useEffect(() => { if (!started) { started = true; api({ name: 'read' }).catch(error => emit({ ...state, loading: false, error })); } }, []);
  return data;
}
const rows = (data, collection, map = value => value) => (data.rows[collection] || []).map(map);
const meta = data => ({ loading: data.loading, error: data.error, refetch: () => api({ name: 'read' }) });
export const callServer = (name, data) => api({ name, data });
const disabled = async () => { throw Error('This operation is outside the isolated test'); };
export function useStartupCosts() { const d = useData(); return { ...meta(d), items: rows(d, 'startup_costs', mapStartupCost), addItem: disabled,
  updateItem: (id, patch, consent) => callServer('startupUpdatePlan', { parentId: id, patch, reason: consent.reason }), deleteItem: id => callServer('startupDeletePlan', { parentId: id }) }; }
export function useAnnualExpenses() { const d = useData(); return { ...meta(d), items: rows(d, 'annual_expenses', mapAnnualExpense), addItem: disabled,
  updateItem: (id, patch, consent) => callServer('annualPlanAction', { ...consent, action: 'update', parentId: id, patch: toAnnualExpenseUpdate(patch) }),
  updateStatus: (id, value, consent) => callServer('annualPlanAction', { ...consent, action: 'update', parentId: id, patch: { payment_status: value } }),
  deleteItem: (id, consent) => callServer('annualPlanAction', { ...consent, action: 'delete', parentId: id }) }; }
export function useStartupLedgerParents() { const d = useData(); return { ...meta(d), parentIds: new Set(rows(d, 'startup_cost_entries').map(row => row.startup_cost_id)) }; }
export function useStartupCostEntries(id) { const d = useData(); return { ...meta(d), entries: rows(d, 'startup_cost_entries', mapStartupCostEntry).filter(row => row.startupCostId === id), addEntry: disabled, deleteEntry: disabled, updateEntry: disabled }; }
export function useAnnualExpenseEntries(id) { const d = useData(); return { ...meta(d), entries: rows(d, 'annual_expense_entries', mapAnnualExpenseEntry).filter(row => row.annualExpenseId === id), addEntry: disabled, deleteEntry: disabled, updateEntry: disabled }; }
export function useAllAnnualEntries() { const d = useData(); return { ...meta(d), entries: rows(d, 'annual_expense_entries', mapAnnualExpenseEntry) }; }
export function useBikers() { const d = useData(); return { ...meta(d), bikers: rows(d, 'bikers', mapBiker) }; }
export function useWashes() { const d = useData(); return { ...meta(d), items: rows(d, 'washes', mapWash) }; }
export function useTemporaryExpenses() { const d = useData(); return { ...meta(d), expenses: rows(d, 'temporary_expenses', mapTemporaryExpense), addTemporaryExpense: disabled, deleteTemporaryExpense: disabled, toggleRecoveryStatus: disabled }; }
export function useIncomePayrollPreviews() { const d = useData(); return { ...meta(d), data: [{ periodKey: '2026-10', lines: [{ bikerId: 'left' }, { bikerId: 'working' }] }] }; }
export const useCategories = () => ({ categories: [{ id: 'test', label: 'اختبار معزول' }], getCategoryLabel: () => 'اختبار معزول', addCategory: disabled });
export const useAnnualExpenseCategories = useCategories;
export const useAccountingSettings = () => ({ settings: {} });
export const usePartnerView = () => ({ role: 'admin', isPartnerView: false, canMutate: true, scalingFactor: 1 });
export const auth = null, db = null, isFirebaseConfigured = true, missingEnvNames = [];
export const dataSource = 'isolated';
export const maskedProjectRef = () => null;
export const callAdvanceMonthPreview = disabled, callAdvanceMonthSave = disabled;
export const describeBackendError = error => error.message;
export const callLedger = callServer;
export const uploadInvoiceFile = disabled;
export default function TestTopBar({ title, subtitle }) { return <header className="p-5"><h1 className="text-xl font-bold">{title}</h1><p>{subtitle}</p></header>; }
