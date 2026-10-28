import { describe, expect, it } from 'vitest';
import { assertFinanceApproval, financeSourceHash } from '../../functions/src/financeReview.js';
import { financeDocumentIdentity, financeSourceEvidence } from '../../functions/src/financeSourceEvidence.js';
import { memoryFinanceDb } from './financeFixtures.js';

import { exceptionSources, allocationSources, originalUrl, evidenceRow, evidenceSeed, evidenceCall, saveEvidence, linkAllocation, approveEvidence } from './financeSourceEvidenceFixtures.js';
const kind = 'startup';

describe('bounded owner quantity evidence', () => {
  it.each(exceptionSources)('preserves only the authorized %s total without inventing quantity or unit cost', async (sourceId, amount) => {
    const db = memoryFinanceDb(evidenceSeed()), before = structuredClone([...db.rows]);
    const initial = await evidenceCall(db, { action: 'read', sourceId });
    const evidence = { version: 1, grantRef: initial.sourceContext.quantityGrant.ref, sourceRef: 'TEST source and owner decision' };
    const preview = await evidenceCall(db, { action: 'preview', sourceId, sourceHash: initial.sourceHash, patch: { quantityException: evidence } });
    expect([...db.rows]).toEqual(before); expect(preview.after).toMatchObject({ amount, quantity: null, unit_cost: null });
    expect(preview.sourceContext.warnings.join()).toContain('قرار هادي');
    const saved = await saveEvidence(db, sourceId, { quantityException: evidence });
    expect(saved.read.approvalReady).toBe(true); expect(saved.read.approved).toBe(false);
    expect(saved.read.postingPreview.lines.find(line => line.accountId === '1500').debit).toBe(amount);
    expect(saved.read.row.payment_status).toBe('unpaid'); expect(saved.read.row.finance_metadata.evidenceRefs).toEqual(['TEST evidence']);
    expect(saved.read.sourceContext.contextHash).toMatch(/^[a-f0-9]{64}$/);
    const audit = [...db.rows.entries()].find(([path]) => path.startsWith('audit_logs/'))[1];
    expect(audit.sourceEvidence.quantityDecision).toMatchObject({ decisionText: '10 مو مهم العدد', decisionAt: '2026-10-26T19:16:11.251Z', amount, sourceId });
    expect(audit.before.quantity).toBe(2); expect(audit.after.quantity).toBeNull();
    await approveEvidence(db, sourceId);
    await assertFinanceApproval(db, { get: ref => ref.get() }, kind, sourceId, db.rows.get(`startup_cost_entries/${sourceId}`));
  });
  it.each(['other-source', 'amount', 'document', 'other-grant', 'empty-ref', 'fake-quantity', 'fake-lines'])('refuses %s reuse of a quantity grant', async mode => {
    const db = memoryFinanceDb(evidenceSeed()), sourceId = exceptionSources[0][0];
    const initial = await evidenceCall(db, { action: 'read', sourceId });
    const evidence = { version: 1, grantRef: initial.sourceContext.quantityGrant.ref, sourceRef: 'TEST evidence' };
    let id = sourceId; const patch = { quantityException: evidence };
    if (mode === 'other-source') { id = 'unrelated'; db.rows.set(`startup_cost_entries/${id}`, structuredClone(initial.row)); }
    if (mode === 'amount') patch.amount = 21;
    if (mode === 'document') patch.invoiceUrl = 'https://example.org/other';
    if (mode === 'other-grant') evidence.grantRef = 'OWNER-ANYTHING';
    if (mode === 'empty-ref') evidence.sourceRef = '';
    if (mode === 'fake-quantity') patch.quantity = 1;
    if (mode === 'fake-lines') patch.invoiceLines = { version: 1, sharedTotal: { amount: 20, description: 'TEST', sourceRef: 'TEST' }, items: [{ id: 'x', description: 'TEST', quantity: 1, unit: 'piece', unitCost: null, amount: null, sourceRef: 'TEST' }] };
    await expect(evidenceCall(db, { action: 'preview', sourceId: id, sourceHash: initial.sourceHash, patch })).rejects.toThrow();
    expect([...db.rows.keys()].some(key => /^(audit_logs|journal_entries|finance_reviews)\//.test(key))).toBe(false);
  });
  it('keeps all non-quantity gaps and period/source locks in force', async () => {
    const db = memoryFinanceDb(evidenceSeed()), sourceId = exceptionSources[0][0], ref = `startup_cost_entries/${sourceId}`;
    const row = db.rows.get(ref); row.payment_status = 'paid'; row.payment_method = 'unknown'; row.finance_metadata.fundingType = 'unknown';
    let read = await evidenceCall(db, { action: 'read', sourceId });
    const saved = await saveEvidence(db, sourceId, { quantityException: { version: 1, grantRef: read.sourceContext.quantityGrant.ref, sourceRef: 'TEST' } });
    expect(saved.read.issues.join()).toContain('تاريخ السداد'); expect(saved.read.issues.join()).toContain('الحساب المقابل'); expect(saved.read.approvalReady).toBe(false);
    db.rows.set('accounting_periods/2026-10', { status: 'closed' });
    read = await evidenceCall(db, { action: 'read', sourceId });
    await expect(evidenceCall(db, { action: 'preview', sourceId, sourceHash: read.sourceHash, patch: {} })).rejects.toThrow(/مقفلة/);
    db.rows.delete('accounting_periods/2026-10'); row.journal_entry_id = 'TEST posted';
    db.rows.get(ref).journal_entry_id = 'TEST posted';
    read = await evidenceCall(db, { action: 'read', sourceId });
    await expect(evidenceCall(db, { action: 'preview', sourceId, sourceHash: read.sourceHash, patch: {} })).rejects.toThrow(/قيد أو قفل/);
  });
});

describe('one original allocated to two existing sources', () => {
  it('refuses the current unlinked duplicate, then previews/saves both links without writing a new source or financial entry', async () => {
    const db = memoryFinanceDb(evidenceSeed()), sourceId = allocationSources[0];
    const before = await evidenceCall(db, { action: 'read', sourceId });
    await expect(evidenceCall(db, { action: 'preview', sourceId, sourceHash: before.sourceHash, patch: {} })).rejects.toThrow(/توزيع مراجع/);
    const grant = before.sourceContext.allocationGrant;
    expect(Object.isFrozen(grant.members)).toBe(true); expect(Object.isFrozen(grant.members[0].lineIds)).toBe(true);
    expect(grant.total).toBe(280); expect(grant.members.map(member => member.amount)).toEqual([200, 80]);
    expect(new Set(grant.members.flatMap(member => member.lineIds)).size).toBe(grant.lines.length);
    expect(grant.lines.reduce((sum, line) => sum + line.amount, 0)).toBe(grant.total);
    for (const member of grant.members) expect(member.lineIds.reduce((sum, id) => sum + grant.lines.find(line => line.id === id).amount, 0)).toBe(member.amount);
    const first = await saveEvidence(db, sourceId, { documentAllocation: { version: 1, grantRef: grant.ref, sourceRef: 'TEST first review' } });
    expect(first.read.approvalReady).toBe(false); expect(first.read.issues.join()).toContain('السجل الآخر');
    await linkAllocation(db);
    for (const id of allocationSources) { const read = await evidenceCall(db, { action: 'read', sourceId: id }); expect(read.approvalReady).toBe(true); expect(read.approved).toBe(false); }
    expect([...db.rows.keys()].filter(key => key.startsWith('startup_cost_entries/'))).toHaveLength(4);
    expect([...db.rows.keys()].some(key => key.startsWith('journal_entries/'))).toBe(false);
  });
  it.each(['over-cap', 'changed-peer', 'missing-peer', 'third-source', 'alias-third', 'fake-group', 'fake-lines', 'replace-url'])('refuses %s without weakening ordinary duplicate protection', async mode => {
    const db = memoryFinanceDb(evidenceSeed()); await linkAllocation(db);
    let sourceId = allocationSources[0]; const patch = {};
    if (mode === 'over-cap') patch.amount = 281;
    if (mode === 'changed-peer') db.rows.get(`startup_cost_entries/${allocationSources[1]}`).amount = 81;
    if (mode === 'missing-peer') db.rows.delete(`startup_cost_entries/${allocationSources[1]}`);
    if (['third-source', 'alias-third'].includes(mode)) { sourceId = 'third'; db.rows.set(`startup_cost_entries/${sourceId}`, evidenceRow(1, mode === 'alias-third' ? `${originalUrl}?usp=sharing` : originalUrl)); }
    if (mode === 'fake-group') patch.documentAllocation = { version: 1, grantRef: 'OTHER', sourceRef: 'TEST' };
    if (mode === 'fake-lines') patch.documentAllocation = { version: 1, grantRef: 'ORIGINAL99-0579-20261028', sourceRef: 'TEST', members: [] };
    if (mode === 'replace-url') patch.invoiceUrl = 'https://example.org/fake-replacement';
    const read = await evidenceCall(db, { action: 'read', sourceId });
    await expect(evidenceCall(db, { action: 'preview', sourceId, sourceHash: read.sourceHash, patch })).rejects.toThrow();
  });
  it('invalidates own and peer-context approval and stale previews when a peer is edited without changing the total', async () => {
    const db = memoryFinanceDb(evidenceSeed()); await linkAllocation(db); await approveEvidence(db, allocationSources[0]);
    const before = await evidenceCall(db, { action: 'read', sourceId: allocationSources[0] }); expect(before.approved).toBe(true);
    const preview = await evidenceCall(db, { action: 'preview', sourceId: before.sourceId, sourceHash: before.sourceHash, patch: { supplier: 'TEST corrected supplier' } });
    await saveEvidence(db, allocationSources[1], { purpose: 'TEST changed review evidence' });
    const after = await evidenceCall(db, { action: 'read', sourceId: before.sourceId });
    expect(after.sourceHash).toBe(before.sourceHash); expect(after.approved).toBe(false); expect(after.postingPreview.postingHash).not.toBe(before.postingPreview.postingHash);
    await expect(evidenceCall(db, { action: 'save', sourceId: before.sourceId, sourceHash: before.sourceHash, patch: { supplier: 'TEST corrected supplier' }, previewHash: preview.previewHash, reason: 'TEST stale', confirm: true })).rejects.toThrow(/تغيرت المعاينة/);
    await expect(assertFinanceApproval(db, { get: ref => ref.get() }, kind, before.sourceId, after.row)).rejects.toThrow(/توزيع الأصل/);
    await approveEvidence(db, before.sourceId); expect((await evidenceCall(db, { action: 'read', sourceId: before.sourceId })).approved).toBe(true);
  });
  it('does not let a linked original waive quantity, funding or tax evidence', async () => {
    const db = memoryFinanceDb(evidenceSeed()); await linkAllocation(db);
    const id = allocationSources[1], row = db.rows.get(`startup_cost_entries/${id}`); row.quantity = null; row.unit_cost = null; row.vat_deductible = true;
    const read = await evidenceCall(db, { action: 'read', sourceId: id });
    expect(read.issues.join()).toContain('الكمية'); expect(read.issues.join()).toContain('غير الضريبي'); expect(read.approvalReady).toBe(false);
  });
  it.each(['sharing-query', 'open-id'])('blocks an already-existing third source with a %s Drive alias before approval and legacy posting', async variant => {
    const db = memoryFinanceDb(evidenceSeed()); await linkAllocation(db); const sourceId = allocationSources[0];
    await approveEvidence(db, sourceId);
    const before = await evidenceCall(db, { action: 'read', sourceId });
    const alias = variant === 'sharing-query' ? `${originalUrl}?usp=sharing` : 'https://drive.google.com/open?id=1kXBQUqAPostNYJ6c9myt3CqBwKKFRM_k';
    db.rows.set('monthly_expenses/injected-alias', { invoice_url: alias });
    await expect(evidenceCall(db, { action: 'approve', sourceId, sourceHash: before.sourceHash, postingHash: before.postingPreview.postingHash,
      reason: 'TEST separate approval', confirm: true })).rejects.toThrow();
    await expect(assertFinanceApproval(db, { get: ref => ref.get() }, kind, sourceId, before.row)).rejects.toThrow('يوجد مصروف آخر بنفس هوية أصل المستند ولو اختلف شكل رابطه؛ راجع التكرار قبل الاعتماد والترحيل.');
    expect([...db.rows.keys()].some(key => key.startsWith('journal_entries/'))).toBe(false);
  });
  it('normalizes only documented Drive identity and never confuses another file or host', () => {
    expect(financeDocumentIdentity(`${originalUrl}?usp=sharing`)).toBe(financeDocumentIdentity(originalUrl));
    expect(financeDocumentIdentity('https://drive.google.com/open?id=1kXBQUqAPostNYJ6c9myt3CqBwKKFRM_k')).toBe(financeDocumentIdentity(originalUrl));
    expect(financeDocumentIdentity(originalUrl.replace('drive.google.com', 'example.org'))).not.toBe(financeDocumentIdentity(originalUrl));
    expect(financeDocumentIdentity('javascript:alert(1)')).toBeNull();
  });
  it('fails closed when any source-kind scan exceeds its complete identity-check coverage', async () => {
    const db = memoryFinanceDb(evidenceSeed()); await linkAllocation(db); const sourceId = allocationSources[0];
    for (let index = 0; index < 1001; index++) db.rows.set(`monthly_expenses/coverage-${index}`, { invoice_url: `https://example.org/synthetic-${index}` });
    const read = await evidenceCall(db, { action: 'read', sourceId });
    expect(read.approvalReady).toBe(false); expect(read.issues.join()).toContain('تغطية فحص هوية');
    await expect(approveEvidence(db, sourceId)).rejects.toThrow();
  });
  it('rejects an ordinary same-invoice duplicate outside the bounded group', async () => {
    const db = memoryFinanceDb(evidenceSeed()), first = 'ordinary-a', second = 'ordinary-b';
    for (const id of [first, second]) db.rows.set(`startup_cost_entries/${id}`, evidenceRow(15, 'https://example.org/same-invoice'));
    const row = db.rows.get(`startup_cost_entries/${first}`);
    await expect(evidenceCall(db, { action: 'preview', sourceId: first, sourceHash: financeSourceHash(row), patch: {} })).rejects.toThrow(/مرتبط بمصروف آخر/);
    expect((await financeSourceEvidence(db, { get: ref => ref.get() }, kind, first, row)).allocationGrant).toBeNull();
  });
});
