import { describe, it, expect } from 'vitest';
import { carryOpenFinanceCases } from '../../scripts/finance-carry-open-cases.mjs';
describe('finance activation carries cases, not old balances', () => {
  it('retains original ids and explicit checks only, excludes closed-only cases and preserves unresolved partial closures', () => {
    const source = { date: '2026-10-18', cutUTC: '2026-10-18T20:08:16Z', cashBalance: 999,
      issues: [{ id: 'OLD-OPEN', status: 'open', evidence: 'Historical only' }, { id: 'OLD-CLOSED', status: 'closed_verified' },
        { id: 'PARTIAL', status: 'policy_closed_funding_open', lastVerifiedAtUTC: '2026-10-17T10:00:00Z' }], targetedCases: [{ id: 'OLD-OPEN', status: 'open', next: 'Verify source' }] };
    const report = carryOpenFinanceCases(source, { cutAtRiyadh: '2026-10-19T10:00:00+03:00', sourceRef: 'TEST-PRIOR-SNAPSHOT' });
    expect(report.metrics).toEqual([]); expect(report.cases.map(c => c.caseId)).toEqual(['OLD-OPEN', 'PARTIAL']);
    expect(report.cases[0].lastVerifiedAt).toBeUndefined(); expect(report.cases[1].lastVerifiedAt).toBe('2026-10-17T10:00:00Z');
    expect(report.cases.every(c => c.status === 'open' && !c.verification)).toBe(true); expect(JSON.stringify(report)).not.toContain('999');
  });
});
