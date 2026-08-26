// ═══════════════════════════════════════════════════════════════════════════
// الطبقة المشتركة — مَن المتصل، وما الذي يُسمح له، وأين يُسلَّم
// ═══════════════════════════════════════════════════════════════════════════
// This used to live inside `index.js`, inlined into twenty-one `onCall`
// wrappers. It moved here for one reason: the trusted server may need to run
// somewhere other than Cloud Functions — Cloud Functions require the Blaze
// plan, and a Blaze plan requires a billing account, which is not available to
// everyone everywhere.
//
// So the accounting has to be reachable from more than one front door. And the
// moment there are two doors, the guard cannot be written twice: two copies of
// «who may reverse an entry» drift, and the drift is invisible until the day
// the wrong one lets someone through.
//
// Hence this file: transport-neutral. Nothing here imports `firebase-functions`
// or knows what HTTP is. It takes `(db, FieldValue, name, data, auth)` and
// returns a result or throws an error carrying a code. `functions/index.js`
// wraps it in `onCall`; `api/ledger.js` wraps it in a request handler. Neither
// contains a single rule of its own.
//
// ── ما لم يتغيّر ──
// The role still comes from `users/{uid}` read SERVER-SIDE, never from a token
// claim and never from the payload. A custom claim would be cheaper and can
// lag a revocation by up to an hour; an accounting system should not honour a
// role its owner revoked forty minutes ago.
// ═══════════════════════════════════════════════════════════════════════════

import {
  postEntry, postSource, reverseEntry, closePeriod, reopenPeriod,
  seedChartOfAccounts, ensureAccount, LedgerError,
} from './ledger.js';
import {
  issueDocument, voidDocument, correctLinkedInvoice, InvoicingError,
} from './invoicing.js';
import { runLegacyInvoiceLinks } from './legacyLinks.js';
import {
  setTaxPolicy, seedTaxPolicy, setAccountingPreferences,
} from './accountingSettings.js';
import { TaxPolicyError } from './taxPolicy.js';
import { PurchaseTaxError } from './purchaseTax.js';
import {
  addStartupEntry, deleteStartupEntry, updateStartupEntry, assignStartupUnits,
  convertLegacyStartupSpend,
  updateStartupPlan, deleteStartupPlan, StartupCostError,
} from './startupCosts.js';
import { claimFirstAdmin, directoryIsEmpty, BootstrapError } from './bootstrapAdmin.js';
import { canPost } from './posting.js';

/** A refusal with a code the transport can translate. Never a bug. */
export class AuthError extends Error {
  constructor(message, { code = 'permission-denied' } = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

// ─── مَن المتصل ──────────────────────────────────────────────────────────

/** Resolves the caller's role from Firestore, never from a client claim. */
export async function callerRole(db, auth) {
  if (!auth?.uid) throw new AuthError('تسجيل الدخول مطلوب.', { code: 'unauthenticated' });
  const [userSnap, adminSnap] = await Promise.all([
    db.collection('users').doc(auth.uid).get(),
    db.collection('app_admins').doc(auth.uid).get(),
  ]);
  if (adminSnap.exists) return 'admin';
  if (!userSnap.exists) throw new AuthError('الحساب غير مُصرَّح له.');
  const role = userSnap.data().role;
  return ['admin', 'accountant', 'operator', 'partner'].includes(role) ? role : 'operator';
}

async function requireAccountant(db, auth) {
  const role = await callerRole(db, auth);
  if (role !== 'admin' && role !== 'accountant') {
    throw new AuthError('الترحيل مقصور على المحاسب أو المدير.');
  }
  return { uid: auth.uid, role };
}

/**
 * An operator may post a WASH and nothing else.
 *
 * The reasoning, written down because it is a real widening of what an
 * operator can touch: an operator already decides when a wash is complete, and
 * auto-posting is meant to fire at exactly that moment. The alternatives were
 * to disable auto-posting for the people who actually use the app, or to give
 * them the accountant role — a far wider grant. So this is the narrow one:
 * `ledgerPostSource` for an allow-listed kind, never a manual entry, never a
 * period close, never a reversal.
 */
async function requirePostSource(db, auth, kind) {
  const role = await callerRole(db, auth);
  if (canPost(role, kind)) return { uid: auth.uid, role };
  throw new AuthError('ترحيل هذا النوع مقصور على المحاسب أو المدير.');
}

/**
 * Recording a startup spend document is operational work — the same people who
 * record every other expense. A `partner` is read-only and is refused here.
 */
async function requireStartupWriter(db, auth) {
  const role = await callerRole(db, auth);
  if (role === 'partner') throw new AuthError('حساب الشريك للاطلاع فقط.');
  return { uid: auth.uid, role };
}

async function requireAdmin(db, auth) {
  const role = await callerRole(db, auth);
  if (role !== 'admin') throw new AuthError('هذه العملية مقصورة على المدير.');
  return { uid: auth.uid, role };
}

/** Authenticated, whoever they are — membership is not required to ask. */
function requireSignedIn(db, auth) {
  if (!auth?.uid) throw new AuthError('تسجيل الدخول مطلوب.', { code: 'unauthenticated' });
  return { uid: auth.uid, role: null };
}

export const GUARDS = {
  accountant: ({ db, auth }) => requireAccountant(db, auth),
  admin: ({ db, auth }) => requireAdmin(db, auth),
  startupWriter: ({ db, auth }) => requireStartupWriter(db, auth),
  postSource: ({ db, auth, data }) => requirePostSource(db, auth, data?.kind),
  signedIn: ({ auth }) => requireSignedIn(null, auth),
  // Reading the proposed links is accountant work; APPLYING them writes to
  // filed documents, so that half is an admin's. One guard, because the
  // distinction is in the payload and splitting it into two callables would
  // let a caller pick the lenient one.
  legacyLinks: ({ db, auth, data }) => (data?.apply === true
    ? requireAdmin(db, auth)
    : requireAccountant(db, auth)),
};

// ─── أين يُسلَّم ─────────────────────────────────────────────────────────
// Each entry is a guard plus a body. The body receives everything it needs and
// reaches for nothing — no module-level `db`, so a test or a second transport
// can supply its own.

const MANUAL_SOURCE_TYPES = ['manual', 'adjustment', 'opening', 'depreciation', 'disposal'];

import {
  sweaterCalculateSettlement, sweaterRecordStatement, sweaterApproveSettlement,
  sweaterApproveAdjustment, sweaterRecordCollection, sweaterCloseSettlement,
  sweaterResolveVariance, sweaterCreateAdjustment,
} from './sweater/handlers.js';
import {
  createIntegrationKey, revokeIntegrationKey, listIntegrationKeys,
} from './sweater/integrationKeys.js';

export const HANDLERS = {
  // ── الترحيل ──
  // `{ kind, sourceId }` is the whole contract — no entry, no lines, no
  // amount. Nothing about the posting can be forged because nothing about it
  // comes from the caller.
  ledgerPostSource: {
    guard: 'postSource',
    run: ({ db, FieldValue, data, uid }) => postSource(
      db, FieldValue, { kind: data?.kind, sourceId: data?.sourceId }, { userId: uid },
    ),
  },

  /**
   * The one path where lines still come from the caller, because there is no
   * single source document to read them from. `sourceType` is confined to the
   * kinds that genuinely have no source record, so this cannot be used to
   * fabricate a wash entry and bypass `ledgerPostSource`.
   */
  ledgerPostManual: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => {
      const requested = data?.entry?.sourceType;
      const sourceType = MANUAL_SOURCE_TYPES.includes(requested) ? requested : 'manual';
      const keepsSourceId = sourceType === 'depreciation' || sourceType === 'disposal';
      const sourceId = String(data?.entry?.sourceId ?? '').trim();
      // A period-end entry's whole idempotency rests on its source id — the
      // period key for a depreciation charge, the asset id for a disposal.
      // Without one there is no lock, so the same month could be depreciated
      // again and again. Refused BEFORE anything is written.
      if (keepsSourceId && !sourceId) {
        throw new AuthError(
          'قيد الإهلاك أو الاستبعاد يحتاج معرّف مصدر — بدونه يمكن تكراره.',
          { code: 'invalid-argument' },
        );
      }
      return postEntry(db, FieldValue, {
        entry: { ...data?.entry, sourceType, sourceId: keepsSourceId ? sourceId : null },
        lines: data?.lines,
      }, { userId: uid, lockKind: keepsSourceId ? sourceType : null });
    },
  },

  ledgerReverseEntry: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => reverseEntry(db, FieldValue, data?.entryId, {
      entryDate: data?.entryDate, description: data?.description, userId: uid,
    }),
  },

  // ── الفترات ──
  ledgerClosePeriod: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => closePeriod(db, FieldValue, data?.periodKey, { userId: uid }),
  },

  // Re-opening a filed month is the one action that changes what a filed
  // period says, so it is an admin's call and carries a reason.
  ledgerReopenPeriod: {
    guard: 'admin',
    run: ({ db, FieldValue, data, uid }) => reopenPeriod(db, FieldValue, data?.periodKey, {
      reason: data?.reason, userId: uid,
    }),
  },

  // ── المستندات الضريبية ──
  // Totals are recomputed from the lines, and the number, sequence, seller
  // identity and issuer all come from the server.
  salesIssueDocument: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => issueDocument(db, FieldValue, data || {}, { userId: uid }),
  },

  // `reversalDate` is threaded through deliberately. Voiding a note reverses
  // its entry, and that reversal lands in a period — so the caller names the
  // date and owns it. Dropping it left a note in a closed month with no way to
  // be voided at all.
  salesVoidDocument: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => voidDocument(db, FieldValue, {
      documentId: data?.documentId, reason: data?.reason, reversalDate: data?.reversalDate,
    }, { userId: uid }),
  },

  // Cancels the document, reverses the wash's entry on an explicit date, frees
  // the posting lock only if that entry still owns it, and releases the source
  // claim — in ONE transaction.
  salesCorrectWashInvoice: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => correctLinkedInvoice(db, FieldValue, {
      documentId: data?.documentId, reason: data?.reason, reversalDate: data?.reversalDate,
    }, { userId: uid }),
  },

  salesLinkLegacyInvoices: {
    guard: 'legacyLinks',
    run: ({ db, FieldValue, data, uid }) => runLegacyInvoiceLinks(
      db, FieldValue, { apply: data?.apply === true }, { userId: uid },
    ),
  },

  // ── سياسة الضريبة ──
  accountingSetTaxPolicy: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid, role }) => setTaxPolicy(db, FieldValue, {
      vatRegistered: data?.vatRegistered,
      washPriceMode: data?.washPriceMode,
      vatRate: data?.vatRate,
      effectiveFrom: data?.effectiveFrom,
      baselineFrom: data?.baselineFrom ?? null,
      baselineNote: data?.baselineNote ?? null,
      reason: data?.reason ?? null,
    }, { userId: uid, role }),
  },

  accountingSeedTaxPolicy: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid, role }) => seedTaxPolicy(db, FieldValue, {
      baselineFrom: data?.baselineFrom, note: data?.note ?? null,
    }, { userId: uid, role }),
  },

  accountingSetPreferences: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => setAccountingPreferences(db, FieldValue, data || {}, { userId: uid }),
  },

  // ── التهيئة ──
  ledgerSeedChart: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => seedChartOfAccounts(db, FieldValue, data?.accounts, { userId: uid }),
  },

  ledgerEnsureAccount: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => ensureAccount(db, FieldValue, data?.account, { userId: uid }),
  },

  // ── سجل مصاريف بند التأسيس ──
  // Three things every write here needs are inexpressible in a rule: re-summing
  // the sibling entries into the parent's `actual_amount` (rules have no fold),
  // re-deriving `status` from that sum, and doing the posting-lock check and
  // the parent update in ONE atomic step.
  startupAddEntry: {
    guard: 'startupWriter',
    run: ({ db, FieldValue, data, uid, role }) => addStartupEntry(db, FieldValue, {
      parentId: data?.parentId, entry: data?.entry,
    }, { userId: uid, role }),
  },

  startupDeleteEntry: {
    guard: 'startupWriter',
    run: ({ db, FieldValue, data, uid, role }) => deleteStartupEntry(db, FieldValue, {
      entryId: data?.entryId,
    }, { userId: uid, role }),
  },

  // ── تعديل مصروف مسجَّل ──
  // Operational work, same guard as recording it. The interesting half is on
  // the server: what may change depends on whether the row is already in the
  // books, and a description change carries into the journal narration in the
  // same transaction — so the ledger never describes a document that no longer
  // says that.
  startupUpdateEntry: {
    guard: 'startupWriter',
    run: ({ db, FieldValue, data, uid, role }) => updateStartupEntry(db, FieldValue, {
      entryId: data?.entryId, patch: data?.patch,
    }, { userId: uid, role }),
  },

  // Filing already-recorded spend under the housing unit it belongs to. One
  // call for the whole distribution: a half-applied batch is worse than a
  // refused one. Moves no money — the parent's total is unchanged by design.
  startupAssignUnits: {
    guard: 'startupWriter',
    run: ({ db, FieldValue, data, uid, role }) => assignStartupUnits(db, FieldValue, {
      parentId: data?.parentId, assignments: data?.assignments,
    }, { userId: uid, role }),
  },

  // Migrating a legacy parent-level amount decides which period a deduction is
  // claimed in — the invoice's, chosen by hand from a record that never held
  // one. An operator recording today's spend has no business back-dating a
  // document into a quarter that may already have been filed.
  startupConvertLegacySpend: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid, role }) => convertLegacyStartupSpend(db, FieldValue, {
      parentId: data?.parentId, form: data?.form,
    }, { userId: uid, role }),
  },

  startupUpdatePlan: {
    guard: 'startupWriter',
    run: ({ db, FieldValue, data, uid, role }) => updateStartupPlan(db, FieldValue, {
      parentId: data?.parentId, patch: data?.patch,
    }, { userId: uid, role }),
  },

  startupDeletePlan: {
    guard: 'startupWriter',
    run: ({ db, FieldValue, data, uid, role }) => deleteStartupPlan(db, FieldValue, {
      parentId: data?.parentId,
    }, { userId: uid, role }),
  },

  // ── تهيئة أول مدير ──
  // Asked before the button is offered, so the app never shows an action that
  // will fail. Authenticated-only — an anonymous probe learns nothing.
  authBootstrapStatus: {
    guard: 'signedIn',
    run: async ({ db }) => ({ unclaimed: await directoryIsEmpty(db) }),
  },

  // The identity comes from the VERIFIED TOKEN; the payload is not read at all.
  authClaimFirstAdmin: {
    guard: 'signedIn',
    run: ({ db, FieldValue, auth }) => claimFirstAdmin(db, FieldValue, {
      uid: auth.uid, email: auth.token?.email || null,
    }),
  },
  // ── تكامل سويتر ──────────────────────────────────────────────────────
  // الوكيل ينقل بيانات ولا شيء غيرها. وكل ما هنا قرارٌ بشري: يمرّ بهوية
  // Firebase ودورها، ويُسجَّل في التدقيق باسم صاحبه.
  //
  // والاحتساب `accountant` لأنه اشتقاقٌ لا يمسّ الدفاتر؛ أما **الاعتماد
  // والإقفال وإنشاء المفاتيح** فـ`admin`: الأول يُثبت إيراد شهرٍ كامل، والثاني
  // قد يُقفل على فرقٍ غير محلول، والثالث يفتح باباً إلى بياناتنا.
  sweaterCalculateSettlement: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => sweaterCalculateSettlement(db, FieldValue, {
      periodKey: data?.periodKey, dryRun: data?.dryRun === true,
    }, { userId: uid }),
  },
  sweaterRecordStatement: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => sweaterRecordStatement(db, FieldValue, {
      periodKey: data?.periodKey, statedNetDue: data?.statedNetDue,
      documentUrl: data?.documentUrl ?? null, note: data?.note ?? null,
    }, { userId: uid }),
  },
  sweaterApproveSettlement: {
    guard: 'admin',
    run: ({ db, FieldValue, data, uid }) => sweaterApproveSettlement(db, FieldValue, {
      periodKey: data?.periodKey, note: data?.note ?? null,
    }, { userId: uid }),
  },
  sweaterCreateAdjustment: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => sweaterCreateAdjustment(db, FieldValue, {
      adjustment: data?.adjustment,
    }, { userId: uid }),
  },
  sweaterApproveAdjustment: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => sweaterApproveAdjustment(db, FieldValue, {
      adjustmentId: data?.adjustmentId, note: data?.note ?? null,
    }, { userId: uid }),
  },
  sweaterRecordCollection: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => sweaterRecordCollection(db, FieldValue, {
      periodKey: data?.periodKey, amount: data?.amount, receivedDate: data?.receivedDate,
      bankAccountId: data?.bankAccountId ?? null, reference: data?.reference ?? null,
    }, { userId: uid }),
  },
  sweaterResolveVariance: {
    guard: 'accountant',
    run: ({ db, FieldValue, data, uid }) => sweaterResolveVariance(db, FieldValue, {
      varianceId: data?.varianceId, resolution: data?.resolution,
      reasonCode: data?.reasonCode ?? null, reasonAr: data?.reasonAr ?? null,
      documentUrl: data?.documentUrl ?? null, reviewerNote: data?.reviewerNote ?? null,
    }, { userId: uid }),
  },
  sweaterCloseSettlement: {
    guard: 'admin',
    run: ({ db, FieldValue, data, uid, role }) => sweaterCloseSettlement(db, FieldValue, {
      periodKey: data?.periodKey, reason: data?.reason ?? null,
    }, { userId: uid, role }),
  },

  // مفاتيح الوكيل: إنشاؤها وإلغاؤها للمدير وحده — وهي الباب إلى بياناتنا.
  // والقائمة للمحاسب لأنها بلا أسرار: معرّفات وبصمات وحالات.
  sweaterCreateIntegrationKey: {
    guard: 'admin',
    run: ({ db, FieldValue, data, uid }) => createIntegrationKey(db, FieldValue, {
      label: data?.label ?? null, actor: uid,
    }),
  },
  sweaterRevokeIntegrationKey: {
    guard: 'admin',
    run: ({ db, FieldValue, data, uid }) => revokeIntegrationKey(db, FieldValue, {
      keyId: data?.keyId, actor: uid, reason: data?.reason ?? null,
    }),
  },
  sweaterListIntegrationKeys: {
    guard: 'accountant',
    run: ({ db }) => listIntegrationKeys(db),
  },

};

export const HANDLER_NAMES = Object.keys(HANDLERS);

// ─── التوجيه ─────────────────────────────────────────────────────────────

/**
 * Turns any refusal into `{ code, message, details }` — one shape both
 * transports translate, so an error means the same thing wherever it surfaced.
 *
 * A refusal to invent a VAT figure names the invoice and says which of the
 * three sources is missing. Folding it into 'internal' would show «حاول مرة
 * أخرى» for a problem retrying cannot fix.
 */
export function normalizeError(e) {
  if (e instanceof AuthError) return { code: e.code, message: e.message, details: null };
  if (e instanceof InvoicingError) {
    return { code: e.code || 'failed-precondition', message: e.message, details: null };
  }
  if (e instanceof LedgerError) {
    return {
      code: e.code || 'failed-precondition', message: e.message,
      details: e.problems ? { problems: e.problems } : null,
    };
  }
  if (e instanceof TaxPolicyError) {
    return { code: e.code || 'invalid-argument', message: e.message, details: null };
  }
  if (e instanceof BootstrapError) {
    return { code: e.code || 'failed-precondition', message: e.message, details: null };
  }
  if (e instanceof StartupCostError) {
    return { code: e.code || 'failed-precondition', message: e.message, details: null };
  }
  if (e instanceof PurchaseTaxError) {
    return {
      code: e.code || 'failed-precondition', message: e.message,
      details: e.reason ? { reason: e.reason } : null,
    };
  }
  // Anything else is a bug: log it in full, tell the caller nothing internal.
  console.error('[ledger] unexpected failure', e);
  return { code: 'internal', message: 'تعذّر إتمام العملية — حاول مرة أخرى.', details: null };
}

/** Thrown by `dispatch`; carries the normalized shape for the transport. */
export class DispatchError extends Error {
  constructor({ code, message, details }) {
    super(message);
    this.name = 'DispatchError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Guard, then body. The single path — whatever the front door.
 *
 * An unknown name is `not-found` rather than a crash: a client built against a
 * newer server should be told the operation does not exist here, not handed a
 * stack trace.
 */
export async function dispatch(db, FieldValue, name, data, auth) {
  const handler = HANDLERS[name];
  if (!handler) {
    throw new DispatchError({
      code: 'not-found', message: `عملية غير معروفة: ${name}`, details: null,
    });
  }
  try {
    const { uid, role } = await GUARDS[handler.guard]({ db, auth, data });
    return await handler.run({ db, FieldValue, data, auth, uid, role });
  } catch (e) {
    throw new DispatchError(normalizeError(e));
  }
}
