export const historySourceId = 'synthetic-corrected-source';
export function correctedSourceSeed({ split = false, missingMirror = false } = {}) {
  const sourceId = historySourceId;
  const lines = [{ accountId: '1500', debit: 100, credit: 0 }, { accountId: '1010', debit: 0, credit: 100 }];
  const seed = {
    'users/test-admin': { role: 'admin' },
    'startup_cost_entries/synthetic-corrected-source': { description: 'أصل اختبار مصحح', amount: 100, spent_date: '2026-05-31', startup_cost_id: 'parent' },
    'journal_entries/old': { sourceKind: 'startup', sourceId, status: 'reversed', entryNumber: 4, reversedBy: 'mirror', lines },
    'journal_entries/current': { sourceKind: 'startup', sourceId, status: 'posted', entryNumber: 137, lines,
      ...(split ? { settlementEntryId: 'payment' } : {}) },
    'journal_entries/funding': { sourceKind: 'owner_cash_bank_correction', status: 'posted', entryNumber: 168,
      cashBankCorrection: { sources: [{ source: `expense:${sourceId}` }] } },
  };
  if (!missingMirror) seed['journal_entries/mirror'] = { status: 'posted', entryNumber: 130, reversalOf: 'old',
    lines: lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })) };
  if (split) seed['journal_entries/payment'] = { sourceKind: 'startup', sourceId, status: 'posted', entryNumber: 138, settlementOf: 'current', lines };
  return seed;
}
