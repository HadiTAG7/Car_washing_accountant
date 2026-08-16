// ═══════════════════════════════════════════════════════════════════════════
// سجل الأصول الثابتة — the fixed-asset register and its postings
// ═══════════════════════════════════════════════════════════════════════════
// The register itself is ordinary operational data: an asset can be corrected
// while it is still just a row. What it PRODUCES — the monthly depreciation
// entry and the disposal entry — goes through the same transactional ledger
// as everything else, so it is equally immutable once posted.
//
// Idempotency is the whole game here. Running the monthly charge twice must
// not depreciate the month twice, so the entry carries the period key as its
// `sourceId` and the poster refuses a period that already has one.
//
// Collections
//   fixed_assets          — the register
//   journal_entries/lines — the postings (sourceType 'depreciation' | 'disposal')
// ═══════════════════════════════════════════════════════════════════════════

import {
  collection, doc, getDoc, getDocs, query, where,
  addDoc, setDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebaseClient.js';
import { fetchRows } from '../firestoreCrud.js';
import { postEntry, fetchEntries, ensureAccount } from './firestoreLedger.js';
import { ACC } from './chartOfAccounts.js';
import {
  normalizeAsset, validateAsset, buildDepreciationEntry, buildDisposalEntry,
  depreciationForPeriod, unpostedDepreciationPeriods, accumulatedThrough,
  hasChargedPeriods, missingChargedPeriods, reconcileDepreciation, addMonths,
} from './depreciation.js';
import { periodKeyOf } from './journal.js';

export const ASSETS_COL = 'fixed_assets';

// A Firestore transaction caps at 500 writes. One depreciation entry writes
// two lines per asset plus a handful of fixed documents, so this is the point
// at which a single monthly entry has to be split — surfaced as a clear error
// rather than an opaque failure deep in the SDK.
const MAX_ASSETS_PER_ENTRY = 200;

function requireDb() {
  if (!isFirebaseConfigured) throw new Error('Firebase غير مُهيّأ.');
}

// ─── السجل ───────────────────────────────────────────────────────────────
export const fetchAssets = () => fetchRows(ASSETS_COL);

export async function fetchAsset(id) {
  const snap = await getDoc(doc(db, ASSETS_COL, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Adds an asset. Validated first — an unschedulable asset helps nobody. */
export async function createAsset(asset, { userId = null } = {}) {
  requireDb();
  const problems = validateAsset(asset);
  if (problems.length) {
    const err = new Error(problems[0]);
    err.problems = problems;
    throw err;
  }
  // Firestore rejects an `undefined` field, and the document key is the id —
  // carrying a second copy in the body is how the two drift apart.
  const { id: _ignored, ...body } = normalizeAsset(asset);
  const ref = await addDoc(collection(db, ASSETS_COL), {
    ...body,
    createdBy: userId,
    createdAt: serverTimestamp(),
    createdAtIso: new Date().toISOString(),
  });
  return { id: ref.id };
}

/**
 * Edits an asset. Cost and life may only change while NOTHING has been posted
 * for it: restating a life after three months of charges would make the
 * schedule disagree with the ledger, and the ledger is the record.
 */
export async function updateAsset(id, patch, { userId = null } = {}) {
  requireDb();
  const current = await fetchAsset(id);
  if (!current) throw new Error('الأصل غير موجود.');
  const merged = normalizeAsset({ ...current, ...patch });
  const problems = validateAsset(merged);
  if (problems.length) {
    const err = new Error(problems[0]);
    err.problems = problems;
    throw err;
  }

  const structural = ['cost', 'salvageValue', 'usefulLifeMonths', 'inServiceDate', 'method'];
  const changesStructure = structural.some(
    (k) => patch[k] !== undefined && String(patch[k]) !== String(current[k]),
  );
  // Only THIS asset's own charges block a restatement — an unrelated asset
  // having been depreciated says nothing about this one.
  if (changesStructure && hasChargedPeriods(current, await postedDepreciationPeriods())) {
    throw new Error(
      'لا يمكن تعديل التكلفة أو العمر الإنتاجي بعد ترحيل قيود إهلاك لهذا الأصل. '
      + 'سجّل التغيير كقيد تسوية، أو استبعد الأصل وأضفه من جديد.',
    );
  }

  await updateDoc(doc(db, ASSETS_COL, id), {
    ...patch, updatedBy: userId, updatedAt: serverTimestamp(),
  });
  return { id };
}


/** Months already charged, read from the ledger rather than from a flag. */
export async function postedDepreciationPeriods() {
  const snap = await getDocs(query(
    collection(db, 'journal_entries'), where('sourceType', '==', 'depreciation'),
  ));
  const set = new Set();
  for (const d of snap.docs) {
    const data = d.data();
    if (data.status === 'posted') set.add(String(data.sourceId));
  }
  return set;
}

// ─── الترحيل ─────────────────────────────────────────────────────────────
/** The gain/loss accounts only matter on a disposal, so they are made lazily. */
async function ensureDisposalAccounts() {
  await ensureAccount({
    code: ACC.ASSET_DISPOSAL_GAIN, nameArabic: 'أرباح استبعاد أصول',
    accountType: 'revenue', normalBalance: 'credit', parentId: null, contra: false, active: true,
  });
  await ensureAccount({
    code: ACC.ASSET_DISPOSAL_LOSS, nameArabic: 'خسائر استبعاد أصول',
    accountType: 'expense', normalBalance: 'debit', parentId: null, contra: false, active: true,
  });
}

/**
 * Posts one month's depreciation.
 *
 * Refuses a period that already carries a posted charge — that check is the
 * difference between a schedule and a double charge. A correction to a posted
 * month is a reversal, exactly like any other entry.
 */
export async function postDepreciationForPeriod(periodKey, { userId = null, assets = null } = {}) {
  requireDb();
  const list = assets || await fetchAssets();
  const already = await postedDepreciationPeriods();
  if (already.has(periodKey)) {
    const err = new Error(`إهلاك الشهر ${periodKey} مُرحّل بالفعل — التصحيح يكون بعكس القيد.`);
    err.code = 'already_posted';
    throw err;
  }

  const { rows, total } = depreciationForPeriod(list, periodKey);
  if (rows.length === 0) {
    const err = new Error(`لا يوجد إهلاك مستحق في الشهر ${periodKey}.`);
    err.code = 'nothing_to_post';
    throw err;
  }
  if (rows.length > MAX_ASSETS_PER_ENTRY) {
    throw new Error(
      `عدد الأصول (${rows.length}) يتجاوز الحد الآمن لقيد واحد (${MAX_ASSETS_PER_ENTRY}). `
      + 'قسّم السجل أو رحّل على دفعات.',
    );
  }

  const built = buildDepreciationEntry(periodKey, list, { createdBy: userId });
  // `lockKind: 'depreciation'` keeps the month idempotent server-side.
  const res = await postEntry(built, { lockKind: 'depreciation' });
  return { ...res, periodKey, total, assetCount: rows.length };
}

/**
 * Posts every month that has a charge and no entry yet, oldest first.
 *
 * Sequential because the entry-number counter is a single document, and a
 * failure on one month is reported without stranding the rest — the same
 * contract as the operational posting sweep.
 */
export async function postDepreciationBacklog({ userId = null, through = null, onProgress } = {}) {
  requireDb();
  const assets = await fetchAssets();
  const already = await postedDepreciationPeriods();
  const pending = unpostedDepreciationPeriods(assets, { postedPeriods: already, through });

  const posted = [], failed = [];
  for (let i = 0; i < pending.length; i += 1) {
    const periodKey = pending[i];
    onProgress?.({ done: i, total: pending.length, label: periodKey });
    try {
      const r = await postDepreciationForPeriod(periodKey, { userId, assets });
      posted.push(r);
    } catch (e) {
      // 'nothing_to_post' is not a failure: an asset may have been disposed
      // of between the scan and the post.
      if (e?.code === 'nothing_to_post') continue;
      failed.push({ periodKey, reason: e?.message || String(e) });
    }
  }
  onProgress?.({ done: pending.length, total: pending.length, label: '' });
  return { posted, failed, pending: pending.length };
}

/**
 * Disposes of an asset: posts the entry, then stamps the register.
 *
 * The ledger is written FIRST. If the register update then fails, the books
 * are still right and the row can be re-stamped; the reverse order would
 * leave an asset marked disposed with nothing in the accounts to show for it.
 */
export async function disposeAsset(id, {
  disposalDate, proceeds = 0, settlementAccount = ACC.CASH, userId = null,
} = {}) {
  requireDb();
  const asset = await fetchAsset(id);
  if (!asset) throw new Error('الأصل غير موجود.');
  if (asset.disposalDate) throw new Error('الأصل مستبعد بالفعل.');

  const entries = await fetchEntries();
  const duplicate = entries.some(
    (e) => e.sourceType === 'disposal' && e.sourceId === id && e.status === 'posted',
  );
  if (duplicate) throw new Error('سبق ترحيل قيد استبعاد لهذا الأصل.');

  // The disposal entry closes accumulated depreciation by what the SCHEDULE
  // says has built up. If some of those months were never posted, that credit
  // is not in 1510 and the entry would drive the account negative and
  // misstate the gain or loss — so bring the asset up to date first.
  const date = String(disposalDate).slice(0, 10);
  const missing = missingChargedPeriods(asset, await postedDepreciationPeriods(), {
    through: addMonths(periodKeyOf(date), -1),
  });
  if (missing.length) {
    throw new Error(
      `يجب ترحيل إهلاك ${missing.length} شهر قبل الاستبعاد (${missing.slice(0, 3).join('، ')}`
      + `${missing.length > 3 ? '…' : ''}) — وإلا لن يطابق مجمّع الإهلاك ما في الدفاتر.`,
    );
  }

  await ensureDisposalAccounts();
  const built = buildDisposalEntry(asset, {
    disposalDate, proceeds, settlementAccount, createdBy: userId,
  });
  const res = await postEntry({ entry: built.entry, lines: built.lines }, { lockKind: 'disposal' });

  await setDoc(doc(db, ASSETS_COL, id), {
    disposalDate: date,
    disposalProceeds: Number(proceeds) || 0,
    disposalEntryId: res.entryId,
    active: false,
    updatedBy: userId,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { ...res, accumulated: built.accumulated, bookValue: built.bookValue, result: built.result };
}

/**
 * Stops an asset without disposing of it — a row entered by mistake, or one
 * that is idle. Deliberately not a delete: an asset with posted charges must
 * stay readable next to the entries that reference it.
 */
export async function setAssetActive(id, active, { userId = null } = {}) {
  requireDb();
  await updateDoc(doc(db, ASSETS_COL, id), {
    active: Boolean(active), updatedBy: userId, updatedAt: serverTimestamp(),
  });
  return { id, active: Boolean(active) };
}

/**
 * Capitalises an existing startup-cost row into the register — the bridge
 * between "we bought a pressure washer" and "it depreciates over five years".
 * Idempotent on `sourceType + sourceId`.
 */
export async function importAssetFromSource({
  sourceType, sourceId, name, cost, inServiceDate,
  usefulLifeMonths = 60, salvageValue = 0, userId = null,
}) {
  requireDb();
  const existing = await getDocs(query(
    collection(db, ASSETS_COL), where('sourceId', '==', sourceId),
  ));
  const already = existing.docs.find((d) => d.data().sourceType === sourceType);
  if (already) return { id: already.id, created: false };

  const { id } = await createAsset({
    name, cost, inServiceDate, usefulLifeMonths, salvageValue, sourceType, sourceId,
  }, { userId });
  return { id, created: true };
}

/** Register + ledger in one read, for the page. */
export async function fetchAssetBundle() {
  const [assets, entries] = await Promise.all([fetchAssets(), fetchEntries()]);
  const postedPeriods = new Set(
    entries.filter((e) => e.sourceType === 'depreciation' && e.status === 'posted')
      .map((e) => String(e.sourceId)),
  );
  return { assets, entries, postedPeriods };
}

export { accumulatedThrough, periodKeyOf, reconcileDepreciation };
