// تطبيق Admin مستقلّ لروابط الشركاء.
//
// اسمٌ خاص به لا التطبيق الافتراضي: `api/ledger.js` يحجز الافتراضي، وهذا
// المسار يُنشر وحده ويُختبر وحده. نسخةٌ باسمها تمنع تصادم التهيئة على نسخة
// Vercel الدافئة — نفس القرار في `passwordResetRuntime.js`.
//
// وAdmin SDK هنا مقصود لا مُتساهَل فيه: القواعد تُعطي دور `partner` قراءةَ
// المجموعات كاملةً (كل السندات، كل الشركاء، كل القيود)، فالحدُّ «حصّته وحده»
// لا يمكن أن يعيش في القواعد — يعيش هنا، في `data.js` و`scope.js`، حيث
// يُرشَّح كل شيء بمعرّف الشريك قبل أن يبلغ الأداة.

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const APP_NAME = 'partner-mcp-vercel';

/** سوء ضبطٍ لا عطل برنامج — يحمل اسم المتغيّر ليصلحه من يملك البيئة. */
export class PartnerMcpConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PartnerMcpConfigError';
    this.code = 'configuration';
  }
}

// المحاكي: Firestore وحده يكفي — هذا المسار لا يتحقق من أي توكن مصادقة.
const usingEmulators = () => Boolean(process.env.FIRESTORE_EMULATOR_HOST);

function serviceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
  if (!raw) {
    throw new PartnerMcpConfigError(
      'FIREBASE_SERVICE_ACCOUNT غير مضبوط — روابط المساعد الذكي للشركاء معطَّلة حتى يُضبط. '
      + 'أضِف محتوى ملف مفتاح الخدمة JSON كاملاً في متغيّرات البيئة على المستضيف.',
    );
  }
  try { return JSON.parse(raw); }
  catch {
    throw new PartnerMcpConfigError(
      'FIREBASE_SERVICE_ACCOUNT ليس JSON صالحاً — ألصق محتوى الملف كاملاً من { إلى }.',
    );
  }
}

export function getPartnerMcpRuntime() {
  let app = getApps().find((candidate) => candidate.name === APP_NAME);
  if (!app) {
    app = initializeApp(usingEmulators()
      ? { projectId: process.env.GCLOUD_PROJECT || 'demo-sweater' }
      : { credential: cert(serviceAccount()) }, APP_NAME);
  }
  return { db: getFirestore(app), FieldValue };
}
