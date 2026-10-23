import { payrollPreapproval } from '../../functions/src/payrollPreapproval';
const params = new URLSearchParams(window.location.search), now = new Date();
const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const bikers = [
  { id: 'departed', name: 'عامل اختبار بلا نهاية', salary: 900, start_date: '2026-08-01', current_status: 'هرب' },
  { id: 'active', name: 'عامل اختبار نشط', salary: 900, start_date: '2026-08-01', current_status: 'شغال' },
  { id: 'future', name: 'عامل اختبار بمباشرة لاحقة', salary: 900, start_date: '2099-01-01', current_status: 'جاهز للاختبار' },
];
const advances = [{ id: 'old', biker_id: 'departed', amount: 50, assignment_month: '2026-09' }, { id: 'current', biker_id: 'active', amount: 200, assignment_month: periodKey }, { id: 'company', amount: 15000 }];
const items = bikers.slice(0, 2).map(b => ({ bikerId: b.id, name: b.name, monthlySalary: 900, basicDue: 900, commission: 0, bonus: 0, deduction: 0,
  advanceOutstanding: b.id === 'active' ? 200 : 0, advanceDeduction: b.id === 'active' ? 200 : 0,
  advanceAllocations: b.id === 'active' ? [{ advanceId: 'current', amount: 200 }] : [], netDue: b.id === 'active' ? 700 : 900,
  startDate: b.start_date, daysEntitled: 31, monthDays: 31, eligibleStart: `${periodKey}-01`, eligibleEnd: `${periodKey}-31` }));
const run = { runId: 'synthetic', periodKey, periodStart: `${periodKey}-01`, periodEnd: `${periodKey}-31`, distributionDate: '2026-01-01', status: params.get('status') || 'draft',
  totals: { basic: 1800, commissions: 0, advances: 200, net: 1600 } };
const record = text => { document.getElementById('fixture-action').textContent = text; };
export const describeBackendError = error => error?.message;
export const maskedProjectRef = () => null;
export const useBikers = () => ({ bikers, loading: false });
export const usePayrollItems = () => ({ data: items, loading: false, refetch: async () => {} });
export const usePayrollRuns = () => ({ runs: params.get('role') === 'partner' ? [] : [run], loading: false, refetch: async () => {},
  preview: async payload => ({ ...run, ...payload, lines: items }),
  preapproval: async payload => {
    if (params.get('error')) throw new Error('Synthetic read failure');
    return payrollPreapproval({ bikers, advances, lines: items, periodKey: payload.periodKey, today: '2026-10-24' });
  },
  approve: async (id, reason) => { if (!reason?.trim()) throw new Error('Reason required'); record(`اعتماد اصطناعي فقط: ${id} — ${reason}`); return { status: 'approved' }; },
  pay: async payload => { if (!payload.paymentMethod) throw new Error('Choose account'); record(`سداد اصطناعي فقط: ${payload.paymentMethod}`); return { status: 'paid' }; },
  saveDraft: async () => { throw new Error('Not part of this preview'); },
});
