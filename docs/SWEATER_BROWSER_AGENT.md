# وكيل متصفح سويتر — مواصفة التكامل

> هذا الملف هو **العقد** بين وكيل المتصفح وبين البرنامج. من يبني الوكيل يحتاج
> هذا الملف وحده؛ ولا يحتاج قراءة شيفرة البرنامج.

## ١. المبدأ الحاكم

الوكيل **ينقل بيانات فقط**. لا يحسب مبلغاً، ولا يقرّر اعتماداً، ولا ينشئ قيداً،
ولا يعرف نسبة ضريبة. التسعير والضريبة والمطابقة والقيود كلها في محرك البرنامج
الخادمي — والوكيل الذي يرسل رقماً محسوباً **يُرفض طلبه صراحةً** لا يُتجاهل حقله.

وإن انتهت جلسة سويتر أو ظهر طلب رمز تحقق: **يتوقف الوكيل بأمان ويرسل نبضة**.
لا يحاول تجاوز مصادقة، ولا يخزّن رمزاً، ولا يعيد المحاولة بلا حدّ.

---

## ٢. نقطة النهاية

```
POST https://<your-app>/api/integrations/sweater/import
Content-Type: application/json
```

### الترويسات

| الترويسة | القيمة |
|---|---|
| `X-Sweater-Key-Id` | معرّف المفتاح، مثل `sk_9f2c…` |
| `X-Sweater-Timestamp` | ثوانٍ منذ Epoch (UTC)، مثل `1780000000` |
| `X-Sweater-Signature` | التوقيع (أدناه) |

### التوقيع

```
bodyHash  = SHA256( canonicalJson(body.records) )        // hex
signature = HMAC-SHA256( secret, `${timestamp}.${importRunId}.${bodyHash}` )   // hex
```

`canonicalJson` = JSON بترتيب مفاتيح **مُرتَّب أبجدياً على كل مستوى**، بلا
مسافات. مثال مرجعي:

```js
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v).sort()
    .map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}
```

> الخادم يحسب `bodyHash` **بنفسه** من السجلات الواردة ولا يأخذه من الترويسات.
> فلا يُوقَّع على بصمةٍ ويُرسَل جسمٌ غيرها.

**الطابع الزمني** يجب أن يكون ضمن ±٣٠٠ ثانية من ساعة الخادم. وساعةٌ منحرفة
تُرفض برسالة تقول مقدار الانحراف.

---

## ٣. جسم الطلب

```jsonc
{
  "importRunId": "2026-05-21T23:30:00Z__daily",   // فريد لكل دفعة، لا يُعاد
  "mode": "import",                               // أو "heartbeat"
  "dryRun": false,
  "agentStatus": "ok",
  "coverage": {
    "rangeFrom":  "2026-05-14",
    "rangeTo":    "2026-05-21",
    "extractedAt":"2026-05-21T23:29:41Z",
    "pageCount":   4,
    "pagesFetched":4,
    "recordCount": 137,
    "isComplete":  true,
    "sourceUrl":  "https://ssp-portal.sweater.sa/..."
  },
  "records": [ /* SweaterOperationRecord[] */ ]
}
```

### `importRunId`

- **فريد لكل دفعة.** الاقتراح: `<extractedAt ISO>__<نوع التشغيل>`.
- إعادة إرسال **نفس المعرّف بنفس الجسم** ⇒ تُعاد النتيجة المخزَّنة بلا أثرٍ
  ثانٍ. هذا هو مسار إعادة المحاولة الآمن بعد انقطاع الشبكة.
- **نفس المعرّف بجسمٍ مختلف ⇒ `409` ويُرفض.** لا يُعاد استعمال معرّف.

### `coverage` — التغطية ليست تزييناً

استيرادٌ فُقدت منه صفحة **ليس استيراداً**: الحجوزات الغائبة تنقص الإيراد ولا
يشي بذلك شيء. فإن فشلت صفحة أو جزءٌ من النطاق:

- أرسل `isComplete: false` و`pagesFetched` الحقيقي،
- تُوسم الدفعة `completed_with_gaps` ويظهر التنبيه في الواجهة،
- ولا تُعتمد تسوية الشهر إلا بقرارٍ صريح.

---

## ٤. `SweaterOperationRecord`

### الحقول

| الحقل | النوع | إلزامي | ملاحظة |
|---|---|:--:|---|
| `sspBookingId` | string | ✅ | **مفتاح التفرّد** |
| `serviceType` | string | ✅ | رمزٌ ثابت، مثل `interior_exterior_wash` |
| `serviceDate` | `YYYY-MM-DD` | ✅ | به تُقرأ القاعدة السارية يومها |
| `rawStatus` | string | ✅ | **كما تعرضها المنصة حرفياً** |
| `bookingKind` | `individual` \| `corporate` | | |
| `serviceTypeLabel` | string | | الاسم المعروض |
| `serviceTime` | string | | |
| `driverName`, `driverExternalId` | string | | |
| `companyNumber`, `region`, `branch`, `companyName` | string | | |
| `vehiclePlate`, `vehicleMake`, `vehicleModel` | string | | عند توفرها |
| `rawPaymentStatus` | string | | `pending` / `recorded` |
| `platformAmount` | number ≥ 0 | | **ما تعرضه المنصة** — ليس المستحق |
| `customerDiscount` | number ≥ 0 | | يُخزَّن ولا يُطرح من المستحق |
| `partnerOperationalDeduction` | number ≥ 0 | | |
| `arrivedAt`, `startedAt`, `completedAt` | ISO date | | لحساب الالتزام بالوقت |
| `rating` | number 0–5 | | |
| `ticketRef`, `violationRef`, `damageRef` | string | | مراجع فقط |
| `compensationAmount` | number ≥ 0 | | |
| `sourceUrl`, `notes` | string | | |

**القائمة بيضاء**: أي حقلٍ غير مذكور أعلاه يُرفض السجل بسببه.

### حالات التشغيل المعروفة

`approved` · `on_the_way` · `arrived` · `washing_started` · `payment_collection`
· `admin_cancelled`

أرسل `rawStatus` **كما هي**. القائمة **مفتوحة**: حالةٌ جديدة لا تُسقَط — تُحفظ
خاماً وتذهب لمراجعةٍ بشرية ولا يُعترف بإيرادها. فلا تُطابق ولا تُترجم ولا تخمّن.

### 🚫 ما لا يجوز إرساله أبداً

إرسال أيٍّ من هذه **يرفض السجل** برمز `forbidden_field`:

- **قرارات مالية**: `netAmount` `vatAmount` `grossAmount` `vatRate` `netRate`
  `grossRate` `accountId` `accountCode` `journalEntry` `lines` `entry`
  `recognitionEligibility` `approvalStatus` `settlementId` `postedAt`
- **أسرار**: `password` `otp` `cookie` `cookies` `authorization` `session`
  `sessionId` `token` `accessToken` `refreshToken` `setCookie`
- **بيانات شخصية بلا حاجة محاسبية**: `customerName` `customerPhone`
  `customerEmail` `customerAddress` `latitude` `longitude` `gpsLat` `gpsLng`

> الوكيل يمرّ على شاشةٍ فيها أسماء عملاء وأرقامهم. **لا تجمعها.** ما لا يلزم
> لإثبات إيرادٍ أو خصم لا يُنقل، والطبقة الخام لا تخزّن جلسةً ولا رمزاً.

---

## ٥. الردود

### نجاح `200`

```jsonc
{
  "result": {
    "importRunId": "…",
    "dryRun": false,
    "replay": false,
    "counts": { "new": 12, "modified": 3, "duplicate": 120, "rejected": 1, "needsReview": 1 },
    "coverageIssues": [],
    "rows": [
      { "sspBookingId": "B-1", "outcome": "new",          "reasonCode": null, "reasonAr": null },
      { "sspBookingId": "B-9", "outcome": "needs_review", "reasonCode": "modified_after_posting",
        "reasonAr": "الحجز مُرحَّل بالفعل وتغيّرت بياناته…" }
    ]
  }
}
```

`outcome` ∈ `new` · `modified` · `duplicate` · `rejected` · `needs_review`

### الأخطاء

| الحالة | الرمز | المعنى | ماذا يفعل الوكيل |
|:--:|---|---|---|
| `400` | `invalid-argument` | جسمٌ أو حقلٌ غير صالح | **لا يُعاد** — أصلِح ثم أرسل بمعرّفٍ جديد |
| `401` | `unauthenticated` | توقيع أو طابع زمني | تحقّق من المفتاح والساعة. لا تكرّر أكثر من مرة |
| `403` | `permission-denied` | المفتاح مُلغى | توقّف وأبلغ |
| `409` | `already-exists` | المعرّف مستعمل بجسمٍ آخر | **لا يُعاد** — ولّد معرّفاً جديداً |
| `412` | `failed-precondition` | إعداد ناقص على الخادم | توقّف وأبلغ |
| `413` | — | الحمولة أكبر من ٢ ميغابايت | قسّمها |
| `429` | `resource-exhausted` | تجاوز حدّ المعدل | انتظر ٦٠ ثانية ثم أعد **بنفس المعرّف** |
| `500` | `internal` | خطأ خادمي | أعد **بنفس المعرّف** بتراجعٍ أسّي، ٣ محاولات كحدّ أقصى |

**قاعدة الإعادة**: أعد بنفس `importRunId` فقط للحالات `429` و`500` وانقطاع
الشبكة — فهي بلا أثرٍ ثانٍ. وأي رفضٍ منطقي (`400`/`409`) لا يُعاد.

---

## ٦. الحدود

| الحدّ | القيمة |
|---|---|
| سجلات لكل دفعة | **٥٠٠** |
| حجم الجسم | **٢ ميغابايت** |
| المعدل | **٣٠ طلباً / ٦٠ ثانية** لكل مفتاح |
| انحراف الساعة | **±٣٠٠ ثانية** |

قسّم الشهر على دفعات إن لزم — كلٌّ بمعرّفها، وترتيبها لا يهم.

---

## ٧. المعاينة `dryRun`

```jsonc
{ "importRunId": "probe-2026-05-21", "dryRun": true, "records": [ … ] }
```

يمرّ بكل شيء — التوقيع، والتحقق، والبحث عن الموجود، والتصنيف — و**لا يكتب
حرفاً**: لا خام، ولا حجوزات، ولا سجل دفعة. استعمله لأول تشغيل، ولاختبار تغييرٍ
في مطابقة الأعمدة.

---

## ٨. النبضة وحالات التوقّف

```jsonc
POST /api/integrations/sweater/import
{
  "mode": "heartbeat",
  "importRunId": "heartbeat",
  "agentStatus": "otp_required",
  "note": "المنصة طلبت رمز تحقق عند تسجيل الدخول"
}
```

> التوقيع للنبضة يُحسب على `agentStatus` بدل `records`:
> `bodyHash = SHA256(canonicalJson(agentStatus))` و`importRunId = "heartbeat"`.

| `agentStatus` | متى | أثره |
|---|---|---|
| `ok` | تشغيل ناجح | يُحدّث آخر ظهور |
| `partial` | نطاقٌ ناقص | تنبيه |
| `session_expired` | انتهت الجلسة | **تنبيه** — يتوقف الوكيل |
| `otp_required` | المنصة تطلب رمزاً | **تنبيه** — يتوقف، ولا يخزّن الرمز |
| `blocked` | مُنع الوصول | **تنبيه** — يتوقف |

الثلاثة الأخيرة **توقّفٌ آمن**: لا محاولة تجاوز، ولا تخزين بيانات اعتماد،
ولا إعادة محاولة تلقائية. يرفع البرنامج العلم في شاشة «تكامل سويتر»، ويتدخّل
الإنسان.

---

## ٩. الجدولة والتقسيم

- **يومياً بعد إغلاق العمليات** (المقترح ١١:٣٠ مساءً بتوقيت الرياض).
- اجلب **تغييرات اليوم السابق**، ثم **أعد فحص آخر سبعة أيام** لالتقاط التعديلات
  المتأخرة — التكرار بلا أثر، فإعادة الفحص رخيصة.
- صفحةً صفحة: اجمع كل الصفحات ثم أرسل، وإن فشلت صفحة فأرسل ما جمعت مع
  `isComplete: false` بدل أن تصمت.

> الجدولة **عند الوكيل** لا عند البرنامج. البرنامج يستقبل ولا يطلب، ويقيس
> التأخّر بآخر استيرادٍ ناجح — فلا يدّعي معرفة موعدٍ لا يملكه.

---

## ١٠. تدوير المفتاح

1. **تكامل سويتر ← أنشئ مفتاحاً** — يُعرض السرّ **مرة واحدة**، انسخه فوراً.
2. حدّث إعداد الوكيل بالمعرّف والسرّ الجديدين.
3. تحقّق من نجاح دفعة.
4. **ألغِ المفتاح القديم** بسببٍ مكتوب.

السرّ **مُعمّى في المخزن ولا يُسترجَع** — لا من الشاشة ولا من الخادم. وفقدُه
ليس كارثة: ألغِ وأنشئ غيره. ولا تضع السرّ في مستودع شيفرة ولا في سجلّ.

---

## ١١. قائمة تحقّق قبل التشغيل

- [ ] المفتاح والسرّ في مخزنٍ آمن عند الوكيل، لا في الشيفرة
- [ ] `canonicalJson` يطابق المرجع أعلاه (اختبره بـ`dryRun`)
- [ ] ساعة الجهاز مضبوطة على NTP
- [ ] `importRunId` فريدٌ لكل دفعة
- [ ] الدفعة ≤ ٥٠٠ سجل
- [ ] لا حقلٍ من قائمة الممنوعات
- [ ] `coverage` صادقة — و`isComplete: false` عند أي فقد
- [ ] الإعادة على `429`/`500` وحدها، بنفس المعرّف، ٣ محاولات
- [ ] نبضةٌ عند كل توقّف
