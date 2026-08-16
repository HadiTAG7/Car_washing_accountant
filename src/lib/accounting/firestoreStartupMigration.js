// ═══════════════════════════════════════════════════════════════════════════
// تحويل المبلغ الفعلي على بند التأسيس — نداء خادم، لا كتابة عميل
// ═══════════════════════════════════════════════════════════════════════════
// This used to do the whole thing from the browser: read the parent, query its
// entries, query the closed periods, and only THEN open a transaction. Every
// one of those three reads was a photograph. Between the photograph and the
// commit an ordinary entry could be added — producing a legacy entry beside it
// for the same money — or a period could be closed, and the conversion would
// commit into it.
//
// The rules now deny client writes to `startup_cost_entries` outright, so the
// conversion is a callable. The server re-reads the parent, its entries and
// the closed periods INSIDE the transaction; a transactional query is part of
// the read set, so an entry appearing mid-flight aborts the commit rather than
// being missed. See functions/src/startupCosts.js.
// ═══════════════════════════════════════════════════════════════════════════

import { callServer } from '../ledgerTransport.js';
import { legacyEntryIdFor } from './startupMigration.js';

/**
 * Turns a legacy parent-level `actual_amount` into a real spend document.
 *
 * `form` carries what the record cannot: `spentDate`, `paymentMethod`, and —
 * for a tax invoice — its number, date and supplier. None is inferred, and
 * `created_at` is not used as any of them.
 *
 * Returns `{ id, created }`; `created: false` means it was already converted
 * and nothing was written a second time.
 */
export async function convertStartupParentSpend(parentId, form = {}) {
  return callServer('startupConvertLegacySpend', { parentId, form });
}

export { legacyEntryIdFor };
