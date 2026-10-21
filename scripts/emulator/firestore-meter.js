// ═══════════════════════════════════════════════════════════════════════════
// عدّاد قراءات المتصفح — يُركَّب بدل `firebase/firestore` في وضع emulator فقط
// ═══════════════════════════════════════════════════════════════════════════
// يعيد تصدير المكتبة كما هي ويلفّ دوال القراءة بقواعد الفوترة:
//   getDocs → عدد المستندات (وأقلها 1) · getDoc → 1
//   onSnapshot → مستندات اللقطة الأولى (وأقلها 1) ثم المستندات المتغيّرة
//   getCountFromServer/getAggregateFromServer → 1 لكل 1000 مطابق
// ويعدّ «الطلبات» منفصلة: كل طلب يُحمَّل في الإنتاج قراءةً أو اثنتين إضافيتين
// لفحص الدور في القواعد (`get(users)`/`exists(app_admins)`).
// النتيجة في `window.__firestoreReads` يقرؤها سكربت القياس.
// ═══════════════════════════════════════════════════════════════════════════

export * from '@firebase/firestore';
import * as firestore from '@firebase/firestore';

const meter = (globalThis.__firestoreReads ||= { reads: 0, requests: 0, listeners: 0, byCollection: {} });

function nameOf(target) {
  const path = target?.path ?? target?._query?.path?.canonicalString?.() ?? '';
  const group = target?._query?.collectionGroup;
  if (group) return `*/${group}`;
  const parts = String(path).split('/').filter(Boolean);
  if (target?.type === 'document' || (parts.length % 2 === 0 && parts.length)) return parts.length > 2 ? `${parts[0]}/*/${parts[parts.length - 2]}` : parts[0];
  return parts.length > 1 ? `${parts[0]}/*/${parts[parts.length - 1]}` : parts[0] || '?';
}
function add(target, n, request = true) {
  meter.reads += n;
  if (request) meter.requests += 1;
  const name = nameOf(target);
  meter.byCollection[name] = (meter.byCollection[name] || 0) + n;
}

export async function getDocs(query) {
  const snap = await firestore.getDocs(query);
  add(query, Math.max(1, snap.size));
  return snap;
}
export async function getDocsFromServer(query) {
  const snap = await firestore.getDocsFromServer(query);
  add(query, Math.max(1, snap.size));
  return snap;
}
export async function getDoc(ref) {
  const snap = await firestore.getDoc(ref);
  add(ref, 1);
  return snap;
}
export async function getDocFromServer(ref) {
  const snap = await firestore.getDocFromServer(ref);
  add(ref, 1);
  return snap;
}
async function aggregateCost(query) {
  // The emulator is free; ask it how many entries the aggregation scanned.
  const counted = await firestore.getCountFromServer(query);
  return Math.max(1, Math.ceil(counted.data().count / 1000));
}
export async function getCountFromServer(query) {
  const result = await firestore.getCountFromServer(query);
  add(query, Math.max(1, Math.ceil(result.data().count / 1000)));
  return result;
}
export async function getAggregateFromServer(query, spec) {
  const result = await firestore.getAggregateFromServer(query, spec);
  add(query, await aggregateCost(query));
  return result;
}
export function onSnapshot(target, ...args) {
  let first = true;
  meter.listeners += 1;
  const meterSnapshot = snap => {
    if (snap && typeof snap.docChanges === 'function') {
      const n = first ? Math.max(1, snap.size) : snap.docChanges().length;
      if (n) add(target, n, first);
    } else if (first) add(target, 1);
    first = false;
  };
  const index = args.findIndex(a => typeof a === 'function' || (a && typeof a.next === 'function'));
  if (index >= 0) {
    const handler = args[index];
    args[index] = typeof handler === 'function'
      ? snap => { meterSnapshot(snap); return handler(snap); }
      : { ...handler, next: snap => { meterSnapshot(snap); return handler.next?.(snap); } };
  }
  return firestore.onSnapshot(target, ...args);
}
