import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { postSource } from '../../functions/src/ledger.js';
import { correctedSourceSeed, historySourceId } from './financePostingHistoryFixture.js';

const auth = { uid: 'test-admin' };
const fixture = options => ({ db: memoryFinanceDb(correctedSourceSeed(options)), sourceId: historySourceId });
describe('read-only corrected expense history', () => {
  it('matches legacy standalone lines without adding duplicate embedded and standalone representations', async () => {
    const { db, sourceId } = fixture();
    for (const id of ['old', 'mirror']) {
      const entry = db.rows.get(`journal_entries/${id}`);
      entry.lines.forEach((line, index) => db.rows.set(`journal_lines/${id}-${index}`, { ...line, entryId: id }));
      if (id === 'old') delete entry.lines;
    }
    const before = JSON.stringify([...db.rows]);
    const detail = await financeWorkbench(db, auth, { action: 'read', kind: 'startup', sourceId });
    expect(detail.postingHistory.reversed[0].mirrorMatched).toBe(true);
    expect((await financeWorkbench(db, auth, { action: 'browse' })).items[0].workflowStage).toBe('posted_review');
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it.each([false, true])('shows current posting separately from reversal history (split=%s), without approving missing evidence', async split => {
    const { db, sourceId } = fixture({ split }), before = JSON.stringify([...db.rows]);
    const detail = await financeWorkbench(db, auth, { action: 'read', kind: 'startup', sourceId });
    expect(detail.workflowStage).toBe('posted_review');
    expect(detail.postingHistory.active.map(j => j.number)).toEqual(split ? [137, 138] : [137]);
    expect(detail.postingHistory.reversed[0]).toMatchObject({ number: 4, reversal: { number: 130 }, mirrorMatched: true });
    expect(detail.postingHistory.fundingCorrections.map(j => j.number)).toEqual([168]);
    expect(detail).toMatchObject({ protectedSource: true, approvalReady: false, postingReady: false, paymentProven: false });
    expect(detail.issues.length).toBeGreaterThan(0);
    expect((await financeWorkbench(db, auth, { action: 'browse' })).items[0].workflowStage).toBe('posted_review');
    expect(JSON.stringify([...db.rows])).toBe(before);
    await expect(financeWorkbench(db, auth, { action: 'post', kind: 'startup', sourceId, sourceHash: detail.sourceHash, confirm: true })).rejects.toThrow();
    await expect(postSource(db, {}, { kind: 'startup', sourceId }, { userId: auth.uid })).rejects.toThrow();
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('does not describe a missing reversal as a verified chain or a fully complete source', async () => {
    const { db, sourceId } = fixture({ missingMirror: true });
    const detail = await financeWorkbench(db, auth, { action: 'read', kind: 'startup', sourceId });
    expect(detail.postingHistory.reversed[0]).toMatchObject({ mirrorMatched: false, reversal: null });
    expect(detail.postingHistory.issues.length).toBeGreaterThan(0);
    expect(detail.workflowStage).toBe('posted_review');
    expect(detail.postingReady).toBe(false);
  });
});
