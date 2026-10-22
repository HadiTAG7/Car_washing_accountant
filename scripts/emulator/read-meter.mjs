// ═══════════════════════════════════════════════════════════════════════════
// عدّاد قراءات Admin SDK — للمحاكي وحده
// ═══════════════════════════════════════════════════════════════════════════
// لوحة Requests في المحاكي تعرض طلبات المتصفح فقط؛ الخادم يقرأ بـ Admin SDK
// خارج القواعد فلا يظهر هناك. فنلفّ أدنى نقاط القراءة في المكتبة — كل قراءة
// (استعلام، مستند، getAll، داخل معاملة أو خارجها) تمرّ بإحداها مرة واحدة:
//   • Query._get        → عدد المستندات المُرجَعة (وأقلها 1، كما تُحتسب الفوترة)
//   • DocumentReader._get → عدد المستندات المطلوبة
//   • AggregateQuery._get → 1 لكل 1000 مستند مطابق
// ═══════════════════════════════════════════════════════════════════════════

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Load the package entry first: its internal modules are circular and only
// resolve in the order the entry imports them.
require('@google-cloud/firestore');
const { Query } = require('@google-cloud/firestore/build/src/reference/query.js');
const { DocumentReader } = require('@google-cloud/firestore/build/src/document-reader.js');
const { AggregateQuery } = require('@google-cloud/firestore/build/src/reference/aggregate-query.js');

export const meter = { reads: 0, calls: 0, byCollection: {} };

function add(collection, n) {
  meter.reads += n;
  meter.calls += 1;
  meter.byCollection[collection] = (meter.byCollection[collection] || 0) + n;
}
const collectionOf = query => {
  const opts = query._queryOptions;
  return opts?.allDescendants ? `*/${opts.collectionId}` : (opts?.parentPath?.segments?.length ? `${opts.parentPath.segments.join('/')}/${opts.collectionId}` : opts?.collectionId) || '?';
};

const queryGet = Query.prototype._get;
Query.prototype._get = async function metered(...args) {
  const response = await queryGet.apply(this, args);
  add(collectionOf(this), Math.max(1, response.result?.size ?? 0));
  return response;
};

const readerGet = DocumentReader.prototype._get;
DocumentReader.prototype._get = async function metered(...args) {
  const response = await readerGet.apply(this, args);
  // A document read is billed whether or not it exists: count the request.
  const names = (this.allDocuments || []).map(ref => {
    const parts = String(ref.path || '?').split('/');
    return parts.length > 2 ? `${parts[0]}/*/${parts[parts.length - 2]}` : parts[0];
  });
  const tally = {};
  for (const name of names) tally[name] = (tally[name] || 0) + 1;
  for (const [name, n] of Object.entries(tally)) add(name, n);
  return response;
};

const aggregateGet = AggregateQuery.prototype._get;
AggregateQuery.prototype._get = async function metered(...args) {
  const response = await aggregateGet.apply(this, args);
  const count = response.result?.data?.().count;
  add(`${collectionOf(this._query)} (aggregate)`, Math.max(1, Math.ceil((Number(count) || 0) / 1000)));
  return response;
};

export function takeMeter() {
  const snapshot = { ...meter, byCollection: { ...meter.byCollection } };
  meter.reads = 0; meter.calls = 0; meter.byCollection = {};
  return snapshot;
}
