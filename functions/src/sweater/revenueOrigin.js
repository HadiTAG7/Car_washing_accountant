// ═══════════════════════════════════════════════════════════════════════════
// مصدر الإيراد — الضمانة الوحيدة التي لا يكفي فيها فصلُ الحسابين
// ═══════════════════════════════════════════════════════════════════════════
// خطرٌ حقيقي لا نظري: الغسلة تُرحَّل إيراداً **نقدياً** على ٤٠٠٠، وحجز سويتر
// سيُرحَّل إيراداً على **ذمم** ٤٠٠١. فلو كان الاثنان يصفان **نفس الخدمة**،
// ظهر إيرادها مرتين في قائمة الدخل — مرة نقداً ومرة ذمّةً — والحسابان
// المنفصلان يجعلان ذلك **مرئياً** لا مستحيلاً. الرؤية ليست منعاً.
//
// فالمنع هنا، بأربع طبقات:
//   ١) **تاريخ تشغيل إلزامي**: منه فصاعداً سويتر هي المصدر المالي الرسمي.
//   ٢) **`revenueOrigin` على كل غسلة**: `direct` وحدها تُرحَّل من وحدة
//      الغسلات. و`sweater` يرفضها المُحوِّل نفسه — لا الواجهة.
//   ٣) **ربطٌ أحاديٌّ في الاتجاهين**: غسلةٌ واحدة لحجزٍ واحد، ولا عكس.
//   ٤) **الاعتراف يتخطّى المربوط بقيدٍ حيّ**: حجزٌ سبق أن رُحِّل عبر غسلته
//      القديمة لا يُرحَّل ثانيةً.
//
// وقبل تاريخ التشغيل لا شيء يُمنع ولا يُرحَّل تلقائياً: تُعرض العمليات
// للمطابقة وحدها، لأن ما قبل التاريخ محاسبةٌ قائمة لا تُعاد كتابتها بأثرٍ رجعي.
// ═══════════════════════════════════════════════════════════════════════════

export const REVENUE_ORIGIN = Object.freeze(['direct', 'sweater', 'other_b2b']);
export const DEFAULT_REVENUE_ORIGIN = 'direct';

export const LINKS_COL = 'sweater_booking_links';

export function clampRevenueOrigin(value) {
  const v = String(value ?? '').trim();
  return REVENUE_ORIGIN.includes(v) ? v : DEFAULT_REVENUE_ORIGIN;
}

/**
 * هل تُرحَّل هذه الغسلة من وحدة الغسلات؟
 *
 * يُستدعى من **مُحوِّل الترحيل** لا من الشاشة: منعٌ في الواجهة يمرّ من أي
 * مسارٍ آخر — أداة صيانة، أو استدعاء مباشر، أو زرٌّ يُضاف لاحقاً.
 */
export function washPostabilityProblem(row) {
  const origin = clampRevenueOrigin(row?.revenue_origin ?? row?.revenueOrigin);
  if (origin === 'direct') return null;

  if (origin === 'sweater') {
    return 'هذه الغسلة مصدرها منصة سويتر — إيرادها يُعترف به من تسوية سويتر '
      + 'الشهرية لا من هنا، وإلا ظهر الإيراد مرتين. افتح تبويب سويتر واعتمد الشهر.';
  }
  return `مصدر إيراد هذه الغسلة «${origin}» — لا يُرحَّل من وحدة الغسلات.`;
}

/** غسلةُ سويتر بلا رقم حجز يتيمةٌ لا تُطابَق ولا تُدقَّق. */
export function washLinkProblems(wash) {
  const problems = [];
  const origin = clampRevenueOrigin(wash?.revenueOrigin ?? wash?.revenue_origin);
  const booking = String(wash?.sspBookingId ?? wash?.ssp_booking_id ?? '').trim();
  if (origin === 'sweater' && !booking) {
    problems.push('غسلة مصدرها سويتر يجب أن تحمل رقم الحجز — وبه تُطابَق وتُدقَّق.');
  }
  if (origin !== 'sweater' && booking) {
    problems.push('رقم حجز سويتر على غسلةٍ مصدرها ليس سويتر — وحّد المصدر أولاً.');
  }
  return problems;
}

const bKey = (sspBookingId) => `b__${encodeURIComponent(String(sspBookingId))}`;
const wKey = (washId) => `w__${encodeURIComponent(String(washId))}`;

/**
 * ربط غسلةٍ بحجز — تفرّدٌ في الاتجاهين **بالبناء** لا بفحصٍ يسبقه سباق.
 *
 * مستندان بمعرّفين حتميين يُنشآن معاً بـ`create`: أحدهما مفتاحه الحجز
 * والآخر مفتاحه الغسلة. فمحاولةُ ربط حجزٍ مربوط، أو غسلةٍ مربوطة، تصطدم
 * بمستندٍ موجود وتفشل — ولو وقعت المحاولتان في اللحظة نفسها.
 */
export async function linkWashToBooking(db, FieldValue, { washId, sspBookingId, actor = null }) {
  const w = String(washId ?? '').trim();
  const b = String(sspBookingId ?? '').trim();
  if (!w || !b) throw new Error('معرّف الغسلة ورقم الحجز مطلوبان.');

  return db.runTransaction(async (tx) => {
    const bRef = db.collection(LINKS_COL).doc(bKey(b));
    const wRef = db.collection(LINKS_COL).doc(wKey(w));
    const [bSnap, wSnap] = await Promise.all([tx.get(bRef), tx.get(wRef)]);

    if (bSnap.exists && bSnap.data().washId !== w) {
      throw new Error(`الحجز ${b} مربوطٌ بغسلةٍ أخرى (${bSnap.data().washId}) — لا يُربط بغسلتين.`);
    }
    if (wSnap.exists && wSnap.data().sspBookingId !== b) {
      throw new Error(`الغسلة ${w} مربوطةٌ بحجزٍ آخر (${wSnap.data().sspBookingId}) — لا تُربط بحجزين.`);
    }
    if (bSnap.exists && wSnap.exists) return { linked: true, alreadyLinked: true };

    const payload = {
      washId: w, sspBookingId: b, linkedBy: actor,
      linkedAt: FieldValue.serverTimestamp(), linkedAtIso: new Date().toISOString(),
    };
    tx.set(bRef, { ...payload, side: 'booking' });
    tx.set(wRef, { ...payload, side: 'wash' });
    return { linked: true, alreadyLinked: false };
  });
}

export async function unlinkWashBooking(db, { washId, sspBookingId }) {
  const batch = db.batch();
  batch.delete(db.collection(LINKS_COL).doc(bKey(sspBookingId)));
  batch.delete(db.collection(LINKS_COL).doc(wKey(washId)));
  await batch.commit();
  return { unlinked: true };
}

export async function linkOfBooking(db, sspBookingId) {
  const snap = await db.collection(LINKS_COL).doc(bKey(sspBookingId)).get();
  return snap.exists ? snap.data() : null;
}

/**
 * تاريخ التشغيل — إلزاميٌّ لأن غيابه يجعل «أيهما المصدر؟» بلا جواب.
 *
 * قبله: الغسلة المحلية هي المصدر، والحجز يُعرض للمطابقة فقط.
 * بعده: الحجز هو المصدر، والغسلة المقابلة لا تُرحَّل.
 */
export function integrationPhase(serviceDate, effectiveFrom) {
  const d = String(serviceDate ?? '').slice(0, 10);
  const from = String(effectiveFrom ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return { known: false, reasonAr: 'تاريخ تشغيل تكامل سويتر غير مضبوط — اضبطه من إعدادات التكامل.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { known: false, reasonAr: 'تاريخ الخدمة غير صالح.' };
  return { known: true, phase: d >= from ? 'sweater_authoritative' : 'pre_integration', effectiveFrom: from };
}
