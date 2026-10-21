// One month of washes, read once per session and shared: the overview, the
// income statement, the washes page and the bikers page all ask for the same
// unit (`<account>|washes:wash_date:<month>`), so a month any of them read
// costs the others nothing. A wash write drops it (tag `washes`).
import { cachedRead } from './readCache';
import { firestoreScopeExecutor } from './accounting/firestoreScopeExecutor';
import { nextMonthKey, compareIds } from './accounting/incomeStatementScope';

export const washMonthKey = (identity, month) => `${identity}|washes:wash_date:${month}`;

export function readWashMonth(identity, month) {
  return cachedRead(washMonthKey(identity, month),
    () => firestoreScopeExecutor.range('washes', 'wash_date', month, nextMonthKey(month)), { tags: ['washes'] });
}

/** Several months, in document-id order — the order a whole-collection read returns. */
export async function readWashMonths(identity, months) {
  const lists = await Promise.all([...new Set(months)].map(month => readWashMonth(identity, month)));
  return lists.flat().sort((a, b) => compareIds(a.id, b.id));
}
