// ═══════════════════════════════════════════════════════════════════════════
// ملفات الفواتير: firebase/storage على حاوية Supabase خاصة اسمها invoices
// ═══════════════════════════════════════════════════════════════════════════
// الرابط المحفوظ في السجل ثابت ويبدأ بـ https (فحوص الاعتماد تشترطه):
//   <SUPABASE_URL>/storage/v1/object/authenticated/invoices/<path>
// لكنه لا يفتح بلا جلسة؛ installInvoiceLinks() يحوّل الضغط عليه — وعلى روابط
// Firebase القديمة بعد نسخ ملفاتها — إلى رابط موقّع قصير العمر.
// ═══════════════════════════════════════════════════════════════════════════
import { getSupabase, SUPABASE_URL } from './client.js';

const BUCKET = 'invoices';
const AUTH_PREFIX = () => `${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/`;
const objectPath = fullPath => String(fullPath).replace(new RegExp(`^${BUCKET}/`), '');

export const getStorage = () => ({ type: 'storage' });
export const ref = (_storage, fullPath) => ({ fullPath, name: String(fullPath).split('/').at(-1), bucket: BUCKET });
export function connectStorageEmulator() { /* not applicable */ }

export async function uploadBytes(objRef, file, metadata = {}) {
  const { error } = await getSupabase().storage.from(BUCKET).upload(objectPath(objRef.fullPath), file, { contentType: metadata.contentType, upsert: false });
  if (error) throw Object.assign(new Error(error.message), { code: /security|permission|unauthor/i.test(error.message) ? 'storage/unauthorized' : 'storage/unknown' });
  return { ref: objRef, metadata };
}
export async function getDownloadURL(objRef) {
  return `${AUTH_PREFIX()}${objectPath(objRef.fullPath).split('/').map(encodeURIComponent).join('/')}`;
}

/** The bucket path behind a stored invoice link (ours, or a Firebase one after its file was copied). */
export function invoicePathOf(url) {
  const s = String(url || '');
  if (s.startsWith(AUTH_PREFIX())) return s.slice(AUTH_PREFIX().length).split('/').map(decodeURIComponent).join('/');
  const fb = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/.exec(s);
  if (fb) return objectPath(decodeURIComponent(fb[1]));
  return null;
}

/** Opens invoice links through a five-minute signed URL. Call once at start-up. */
export function installInvoiceLinks(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return () => {};
  const onClick = (event) => {
    const a = event.target?.closest?.('a[href]');
    const path = a && invoicePathOf(a.href);
    if (!path) return;
    event.preventDefault();
    const tab = window.open('', '_blank');
    getSupabase().storage.from(BUCKET).createSignedUrl(path, 300).then(({ data, error }) => {
      if (error || !data?.signedUrl) { tab?.close(); window.alert('تعذّر فتح الملف.'); return; }
      if (tab) tab.location.href = data.signedUrl; else window.location.assign(data.signedUrl);
    });
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
