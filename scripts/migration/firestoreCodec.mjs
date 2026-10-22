// ═══════════════════════════════════════════════════════════════════════════
// ترميز قيم Firestore في JSON بلا فقد — لتصدير النقل ولإعادة بنائها حرفياً
// ═══════════════════════════════════════════════════════════════════════════
// JSON وحده يفقد ما يميّز Firestore: الطابع الزمني يصير نصاً، والمرجع
// كائناً عادياً، وNaN/Infinity لا تُكتب أصلاً. فكل نوعٍ ليس JSON صرفاً يُلفّ
// بوسمٍ واحد يبدأ بـ`$fs:` ولا يتصادم مع حقول التطبيق (لا حقل فيه يبدأ بـ`$`).
//
//   Timestamp      → { "$fs:ts": { "s": seconds, "n": nanoseconds } }
//   DocumentRef    → { "$fs:ref": "collection/doc/…" }
//   GeoPoint       → { "$fs:geo": [lat, lng] }
//   Bytes          → { "$fs:bytes": base64 }
//   NaN/±Infinity  → { "$fs:num": "NaN" | "Infinity" | "-Infinity" }
//   -0             → { "$fs:num": "-0" }
//
// الأرقام العادية تمرّ كما هي: JSON.stringify يكتب أقصر تمثيلٍ يعيد نفس
// الـdouble، فـ0.30000000000000004 تبقى 0.30000000000000004.
// ═══════════════════════════════════════════════════════════════════════════

import { TAG, tagOf } from '../../src/lib/data/schema/tags.js';

export { TAG, tagOf };

export function encodeValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { [`${TAG}num`]: 'NaN' };
    if (value === Infinity) return { [`${TAG}num`]: 'Infinity' };
    if (value === -Infinity) return { [`${TAG}num`]: '-Infinity' };
    if (Object.is(value, -0)) return { [`${TAG}num`]: '-0' };
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(encodeValue);
  const kind = value.constructor?.name;
  if (typeof value.toDate === 'function' && 'seconds' in value && 'nanoseconds' in value) {
    return { [`${TAG}ts`]: { s: value.seconds, n: value.nanoseconds } };
  }
  if (kind === 'DocumentReference' || (typeof value.path === 'string' && typeof value.collection === 'function' && 'firestore' in value)) {
    return { [`${TAG}ref`]: value.path };
  }
  if (kind === 'GeoPoint' || (typeof value.latitude === 'number' && typeof value.longitude === 'number' && typeof value.isEqual === 'function')) {
    return { [`${TAG}geo`]: [value.latitude, value.longitude] };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { [`${TAG}bytes`]: Buffer.from(value).toString('base64') };
  if (kind === 'Bytes' && typeof value.toBase64 === 'function') return { [`${TAG}bytes`]: value.toBase64() };
  const out = {};
  for (const key of Object.keys(value)) out[key] = encodeValue(value[key]);
  return out;
}

