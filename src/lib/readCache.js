// ═══════════════════════════════════════════════════════════════════════════
// ذاكرة القراءات المشتركة — قراءةٌ واحدة للجلسة بدل قراءةٍ مع كل فتح صفحة
// ═══════════════════════════════════════════════════════════════════════════
// المشروع على الخطة المجانية: 50 ألف قراءة في اليوم للمشروع كله. وكل تبويب
// كان يُركَّب من جديد فيعيد قراءة مجموعاته كاملة، ونفس المجموعة تُقرأ مرتين في
// الصفحة الواحدة. هنا تُحفظ النتيجة في ذاكرة الصفحة باسمٍ ثابت:
//   • الطلبات المتزامنة لنفس الاسم تشترك في وعدٍ واحد.
//   • الرجوع لصفحة أو تبديل تبويب يأخذ المحفوظ بلا قراءة.
//   • كل كتابة تُسقط ما يتعلق بمجموعتها (`invalidateCollections`)، وكل عملية
//     خادم كاتبة تُسقط الكل — فلا صفحة تعرض ما غيّرته صفحة أخرى.
//   • زر «تحديث» يمسح الكل ويطلب من الصفحة المفتوحة إعادة القراءة.
// الذاكرة لحساب واحد: تغيّر المستخدم يمسحها (`setReadCacheOwner`).
// لا شيء يُحفظ خارج ذاكرة الصفحة؛ إعادة تحميل التطبيق تبدأ من جديد.
// ═══════════════════════════════════════════════════════════════════════════

const entries = new Map();      // key → { promise, data, hasData, at, tags }
const watchers = new Map();     // key → Set(fn(data))
const refreshers = new Map();   // fn → collections it reads (null: the refresh button only) — mounted readers
let owner;
let refreshedAt = Date.now();

const tagsOf = (key, tags) => (tags?.length ? tags : [String(key).split(':')[0]]);

/** Same account → keep; another account (or sign-out) → forget everything. */
export function setReadCacheOwner(uid) {
  const next = uid || null;
  if (owner !== undefined && owner !== next) {
    entries.clear();
    refreshedAt = Date.now();
  }
  owner = next;
}

/**
 * Reads through the cache. `force` skips a stored value (a refetch after a
 * write) and tells every other reader of the same key about the new data.
 */
export function cachedRead(key, fetcher, { force = false, tags } = {}) {
  const hit = entries.get(key);
  if (!force && hit) return hit.promise;
  const promise = Promise.resolve().then(fetcher);
  const entry = { promise, data: hit?.data, hasData: Boolean(hit?.hasData), at: hit?.at ?? 0, tags: tagsOf(key, tags) };
  entries.set(key, entry);
  promise.then(data => {
    if (entries.get(key) !== entry) return;
    Object.assign(entry, { data, hasData: true, at: Date.now() });
    for (const fn of watchers.get(key) || []) fn(data);
  }, () => {
    // A failed read is not a value: the next reader tries again.
    if (entries.get(key) === entry) entries.delete(key);
  });
  return promise;
}

/** The stored value, if any, without reading. */
export function peekCached(key) {
  const hit = entries.get(key);
  return hit?.hasData ? { data: hit.data, at: hit.at } : null;
}

/** Notified when another reader of `key` stores newer data. */
export function watchCached(key, fn) {
  if (!watchers.has(key)) watchers.set(key, new Set());
  watchers.get(key).add(fn);
  return () => watchers.get(key)?.delete(fn);
}

/**
 * Drops every entry that read one of these collections, and every server
 * report (tag `*`): those are computed from many collections at once.
 */
export function invalidateCollections(collections) {
  const names = new Set(collections);
  for (const [key, entry] of entries) {
    if (entry.tags.some(tag => tag === '*' || names.has(tag))) entries.delete(key);
  }
}

/** Drops everything — after a server operation whose effects span collections. */
export function invalidateAllReads() {
  entries.clear();
}

/**
 * A mounted reader that should re-read when the user presses «تحديث», and —
 * when it names the collections it reads — after a posting to one of them.
 */
export function onReadRefresh(fn, collections = null) {
  listen();
  refreshers.set(fn, collections);
  return () => refreshers.delete(fn);
}

/** The refresh button: forget everything and re-read what is on screen. */
export function refreshAllReads() {
  entries.clear();
  refreshedAt = Date.now();
  for (const fn of [...refreshers.keys()]) fn();
}

// ── بعد الترحيل ──
// A posting changes the journal. What was read from it is dropped and the
// readers on screen re-read it now — here and in this app's other open tabs
// (same browser, same signed-in account) — so the trial balance and the
// statements show the new entry without reloading. Only collection names
// cross tabs, never data.
const CHANNEL = 'sweater-read-cache';
let bus;
function listen() {
  if (bus !== undefined) return bus;
  bus = null;
  try {
    if (typeof BroadcastChannel === 'function') {
      bus = new BroadcastChannel(CHANNEL);
      bus.unref?.(); // Node (tests) only: never keeps the process alive.
      bus.onmessage = ({ data }) => {
        if (data?.type === 'refresh' && Array.isArray(data.collections)) {
          refreshCollections(data.collections.filter(name => typeof name === 'string'), { broadcast: false });
        }
      };
    }
  } catch { bus = null; }
  return bus;
}

/** Drops these collections' reads and re-reads the mounted readers that hold them; tells the other tabs too. */
export function refreshCollections(collections, { broadcast = true } = {}) {
  const names = new Set(collections);
  invalidateCollections([...names]);
  // Readers of the same key share one read: the entries were just dropped, so no forced re-read.
  for (const [fn, reads] of [...refreshers]) if (reads?.some(tag => tag === '*' || names.has(tag))) fn({ force: false });
  if (broadcast) listen()?.postMessage({ type: 'refresh', collections: [...names] });
}

export const readsRefreshedAt = () => refreshedAt;

/** Test-only. */
export function __resetReadCache() {
  entries.clear(); watchers.clear(); refreshers.clear();
  owner = undefined; refreshedAt = Date.now();
  bus?.close(); bus = undefined;
}
