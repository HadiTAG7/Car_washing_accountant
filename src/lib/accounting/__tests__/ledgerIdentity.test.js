import { describe, it, expect } from 'vitest';
import { hasPostedEntryFor } from '../firestoreLedger';

/**
 * Source identity is the KIND plus the id.
 *
 * Five collections post with `sourceType: 'expense'`, so a monthly expense and
 * a variable expense that happen to share a document id used to mask each
 * other: whichever posted first made the other look already-done, and it would
 * never have reached the books.
 */
describe('هوية المصدر = النوع + المعرّف', () => {
  const posted = (over) => ({ status: 'posted', ...over });

  it('نوعان مختلفان بنفس المعرّف لا يحجب أحدهما الآخر', () => {
    const entries = [posted({ sourceKind: 'monthly', sourceType: 'expense', sourceId: 'same-id' })];
    expect(hasPostedEntryFor(entries, 'monthly', 'same-id', 'expense')).toBe(true);
    expect(hasPostedEntryFor(entries, 'variable', 'same-id', 'expense')).toBe(false);
    expect(hasPostedEntryFor(entries, 'annual', 'same-id', 'expense')).toBe(false);
    expect(hasPostedEntryFor(entries, 'startup', 'same-id', 'expense')).toBe(false);
    expect(hasPostedEntryFor(entries, 'voucher', 'same-id', 'expense')).toBe(false);
  });

  it('القيد المعكوس لا يُعدّ مُرحّلاً', () => {
    const entries = [{ status: 'reversed', sourceKind: 'wash', sourceId: 'w1' }];
    expect(hasPostedEntryFor(entries, 'wash', 'w1', 'wash')).toBe(false);
  });

  // ── قيد المرآة ──
  // The mirror is itself POSTED, and older mirrors were written carrying the
  // original's sourceType/sourceId. So after reversing a wash the lock was
  // released — the record was free to correct — while this function still
  // said "already posted" and the correction could never be posted at all.
  it('قيد المرآة ليس ترحيلاً للمصدر مهما حمل من هوية', () => {
    const pair = [
      { status: 'reversed', sourceKind: 'wash', sourceId: 'w1' },
      // A mirror written the OLD way, inheriting the source identity.
      posted({ sourceKind: 'wash', sourceId: 'w1', reversalOf: 'e1' }),
    ];
    expect(hasPostedEntryFor(pair, 'wash', 'w1', 'wash')).toBe(false);

    // A mirror written the new way says nothing about the source at all.
    const modern = [
      { status: 'reversed', sourceKind: 'wash', sourceId: 'w1' },
      posted({ sourceType: 'adjustment', sourceId: null, reversalOf: 'e1', reversedSourceId: 'w1' }),
    ];
    expect(hasPostedEntryFor(modern, 'wash', 'w1', 'wash')).toBe(false);

    // And re-posting really does register: the fresh entry is not a reversal.
    const reposted = [...pair, posted({ sourceKind: 'wash', sourceId: 'w1' })];
    expect(hasPostedEntryFor(reposted, 'wash', 'w1', 'wash')).toBe(true);
  });

  it('ولا للمصروفات القديمة التي تحمل sourceType فقط', () => {
    const legacyPair = [
      { status: 'reversed', sourceType: 'expense', sourceId: 'm1' },
      posted({ sourceType: 'expense', sourceId: 'm1', reversalOf: 'e1' }),
    ];
    expect(hasPostedEntryFor(legacyPair, 'monthly', 'm1', 'expense')).toBe(false);
  });

  // Entries written before `sourceKind` existed carry only the source type,
  // and must keep counting as posted or the sweep would double-post them.
  it('القيد القديم بلا sourceKind يُقرأ بنوع المصدر', () => {
    const legacy = [posted({ sourceType: 'expense', sourceId: 'm1' })];
    expect(hasPostedEntryFor(legacy, 'monthly', 'm1', 'expense')).toBe(true);
    expect(hasPostedEntryFor(legacy, 'variable', 'm1', 'expense')).toBe(true);
    // …but a wash is a different source type, so it is untouched.
    expect(hasPostedEntryFor(legacy, 'wash', 'm1', 'wash')).toBe(false);
  });

  it('العهدة واستردادها سجل واحد بنوعين', () => {
    const entries = [posted({ sourceKind: 'temporary_expense', sourceId: 't1' })];
    expect(hasPostedEntryFor(entries, 'temporary_expense', 't1', 'temporary_expense')).toBe(true);
    expect(hasPostedEntryFor(entries, 'recovery', 't1', 'recovery')).toBe(false);
  });

  it('لا يخلط بين معرّفين مختلفين', () => {
    const entries = [posted({ sourceKind: 'wash', sourceId: 'w1' })];
    expect(hasPostedEntryFor(entries, 'wash', 'w2', 'wash')).toBe(false);
  });
});
