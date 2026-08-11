/**
 * Test helper: routes the client ledger layer at the REAL server code.
 *
 * The app calls Cloud Functions; a test cannot, without an auth emulator and
 * a deployed function. So the emulator suites install a transport that
 * dispatches straight into `functions/src/ledger.js` against the same
 * Firestore instance the app is pointed at.
 *
 * This is not a mock. It is the production server module, running the
 * production validation, writing to a real database — only the network hop
 * and the role check are skipped. Role enforcement is covered separately in
 * functions/test and by the rules suite.
 */
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  postEntry, postSource, reverseEntry, closePeriod, reopenPeriod,
  seedChartOfAccounts, ensureAccount,
} from '../../../../functions/src/ledger.js';
import { issueDocument, voidDocument } from '../../../../functions/src/invoicing.js';
import { __setLedgerTransport } from '../../ledgerTransport';
import { app as clientApp } from '../../firebaseClient';

let adminApp = null;
let seq = 0;

/**
 * Installs the transport. Returns a teardown that restores the original.
 *
 * The project id defaults to the CLIENT app's, because the emulator namespaces
 * data by project: an admin instance on a different id would write into a
 * database the test's client reads nothing from, and every assertion would
 * fail on empty results for a reason that has nothing to do with the code.
 */
export function useServerTransport(projectId = clientApp?.options?.projectId || 'demo-sweater') {
  seq += 1;
  adminApp = initializeApp({ projectId }, `srv-${seq}-${process.pid}`);
  const adb = getFirestore(adminApp);
  const uid = 'test-user';

  const previous = __setLedgerTransport(async (name, payload) => {
    switch (name) {
      case 'ledgerPostSource':
        return postSource(adb, FieldValue, payload, { userId: uid });
      case 'ledgerPostManual': {
        // Mirrors the callable's gate exactly, so these suites exercise the
        // production contract rather than a looser one.
        const requested = payload.entry?.sourceType;
        const sourceType = ['manual', 'adjustment', 'opening', 'depreciation', 'disposal']
          .includes(requested) ? requested : 'manual';
        const keepsSourceId = sourceType === 'depreciation' || sourceType === 'disposal';
        return postEntry(adb, FieldValue, {
          entry: {
            ...payload.entry, sourceType,
            sourceId: keepsSourceId ? payload.entry?.sourceId ?? null : null,
          },
          lines: payload.lines,
        }, { userId: uid, lockKind: keepsSourceId ? sourceType : null });
      }
      case 'salesIssueDocument':
        return issueDocument(adb, FieldValue, payload, { userId: uid });
      case 'salesVoidDocument':
        return voidDocument(adb, FieldValue, payload, { userId: uid });
      case 'ledgerReverseEntry':
        return reverseEntry(adb, FieldValue, payload.entryId, { ...payload, userId: uid });
      case 'ledgerClosePeriod':
        return closePeriod(adb, FieldValue, payload.periodKey, { userId: uid });
      case 'ledgerReopenPeriod':
        return reopenPeriod(adb, FieldValue, payload.periodKey, { ...payload, userId: uid });
      case 'ledgerSeedChart':
        return seedChartOfAccounts(adb, FieldValue, payload.accounts, { userId: uid });
      case 'ledgerEnsureAccount':
        return ensureAccount(adb, FieldValue, payload.account, { userId: uid });
      default:
        throw new Error(`دالة غير معروفة: ${name}`);
    }
  });

  return async () => {
    __setLedgerTransport(previous);
    if (adminApp) { await deleteApp(adminApp); adminApp = null; }
  };
}
