# النقل إلى Supabase — دليل التشغيل

الفرع: `claude/supabase-migration`. لا شيء هنا يمسّ Firebase ولا الإنتاج: المفتاح
`DATA_SOURCE` غير مضبوط = الموقع يعمل على Firebase كما هو.

## كيف يعمل

| الطبقة | على Firebase | على Supabase |
|---|---|---|
| المتصفح | `firebase/*` | `src/lib/data/supabase/*` (Vite يوجّه نفس الاستيرادات) — القراءة PostgREST تحت RLS، الكتابة `apply_writes` |
| الخادم (`api/`, `server/`, `functions/src`) | firebase-admin | `pgstore` (نفس واجهة firebase-admin فوق Postgres) بدور `ledger_server` المحدود |
| الدخول | Firebase Auth | Supabase Auth؛ الخادم يتحقق من التوكن ومن أن الجلسة حيّة |
| الملفات | Firebase Storage | حاوية `invoices` الخاصة، روابط موقّعة قصيرة |
| الميزان والمركز المالي | JS على كل القيود | مجاميع SQL (`posted_line_sums`) + نفس كود العرض |

## الاختبارات المحلية

```bash
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx supabase start   # مرة واحدة
npm run test:supabase        # القاعدة وRLS، طبقة المتصفح، النسخ الاحتياطي
npm run test:functions:pg    # كل اختبارات الخادم على Postgres
npm run test:pgstore         # pgstore ↔ محاكي Firestore
```

## نقل البيانات

```bash
# 1) تصدير (قراءة فقط من Firebase، مرة واحدة، قابل للاستئناف)
node scripts/migration/export-firestore.mjs --plan
node scripts/migration/export-firestore.mjs --download-files
node scripts/migration/profile.mjs                 # ورقة القرارات
# 2) استيراد (كله أو لا شيء؛ جدول الأعداد في migration-data/import-report.md)
SUPABASE_DB_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  node scripts/migration/import-supabase.mjs --dir migration-data
# 3) المطابقة الشهرية (Firebase من التصدير ↔ Supabase)
RECONCILE_EXPECT_OCTOBER=1 RECONCILE_DIR=migration-data npm run reconcile
```

حين لا يصل اتصال Postgres المباشر (مثل بيئة Claude السحابية)، نفس الاستيراد عبر HTTPS
بواجهة إدارة Supabase — نفس البوابات، والتبديل في عملية واحدة بعد مرحلة مؤقتة:

```bash
SUPABASE_ACCESS_TOKEN=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  node scripts/migration/import-supabase.mjs --dir migration-data --via api --project <ref>
# تجربته محلياً بنفس السلوك: --via sql (على SUPABASE_DB_URL)
# بصمة كل جدول (نفس النص محلياً وبعيداً، الأوقات UTC) — تُقارن بالاستيراد المحلي المرجعي:
node scripts/migration/db-fingerprint.mjs > local.json
SUPABASE_ACCESS_TOKEN=… node scripts/migration/db-fingerprint.mjs --via api --project <ref> > remote.json
```

`service_role` يُستعمل في سكربتات النقل المحلية فقط، ولا يدخل الموقع ولا Vercel.

## أول دخول

المستخدمون يُنقلون بنفس الإيميل وبلا كلمة مرور. كل مستخدم:
1. يفتح الموقع ← «نسيت كلمة المرور» ← يكتب إيميله.
2. تصله رسالة «تعيين كلمة المرور — سويتر» ← يضغط الزر ← يختار كلمة مرور ← «حفظ».

الرسالة تحتاج SMTP في المشروع (بريد Supabase المدمج يرسل لأعضاء الفريق فقط)، وقالبها
العربي (`supabase/templates/recovery.html`) لا يُقبل على الخطة المجانية إلا بعد ضبط SMTP خاص —
فيُرفع القالب مع SMTP. إلى أن يُضبط: `node scripts/migration/first-login-links.mjs` يولّد لكل مستخدم رابطاً
خاصاً في `migration-data/first-login-links.md` يرسله المدير بنفسه (مرة واحدة،
صلاحية محدودة).

## التشغيل المتوازي (Vercel Preview)

متغيرات Preview في Vercel (Settings ← Environment Variables ← Preview، لفرع
`claude/supabase-migration` فقط):

| المتغير | القيمة | سرّي؟ |
|---|---|---|
| `VITE_DATA_SOURCE` | `supabase` | لا |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | لا |
| `VITE_SUPABASE_ANON_KEY` | المفتاح العام `sb_publishable_…` (أو anon القديم) | لا |
| `DATA_SOURCE` | `supabase` | لا |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | لا |
| `LEDGER_DB_URL` | من `scripts/migration/server-role.mjs` (عبر Supavisor، 6543) | **نعم** |
| `SUPABASE_JWT_SECRET` | فقط إن كان المشروع ما زال يوقّع بـ HS256 (مفاتيح التوقيع في اللوحة) | **نعم** |

- TLS للقاعدة متحقَّق منه بالكامل مقابل شهادة Supabase الجذرية المدمجة في الكود
  (`server/db/supabaseCa.js`)؛ و`sslmode` في الرابط يُتجاهل. `LEDGER_DB_CA` لاستبدالها فقط.
- `service_role` لا يدخل Vercel.

الدوال في دبلن (`regions: ["dub1"]`) بجانب القاعدة في أيرلندا.

جولة كل الصفحات على المعاينة (مدير وشريك) — لا تُغيَّر كلمة مرور أحد: جلسة مؤقتة من Auth
Admin تُغلق في النهاية، ورمز تجاوز حماية Vercel يُرسل لطلبات الموقع فقط:

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ACCESS_TOKEN=… VERCEL_BYPASS=… \
  node scripts/migration/ui-smoke.mjs --base https://<المعاينة>
```

## التحويل النهائي (بعد موافقتك)

1. إعلان وقت التحويل، وإيقاف الإدخال في الموقع الحالي (لا تعديل في بيانات Firebase).
   قبله: SMTP خاص في Supabase + قالب الرسالة العربي + رابط الموقع وروابط العودة للنطاق النهائي.
2. تصدير أخير ← استيراد ← نفس البوابات ← تقرير المطابقة: صفر فروقات.
3. ضبط نفس المتغيرات في Production ثم دمج الفرع ونشره.
4. فتح الموقع، ومطابقة أرقام الشهر الحالي، ثم إعلام المستخدمين بأول دخول.

## الرجوع

- إعادة `DATA_SOURCE` و`VITE_DATA_SOURCE` إلى `firebase` (أو حذفهما) ثم إعادة النشر:
  الموقع يعود لـ Firebase كما كان — Firebase لم يُمسّ.
- ما أُدخل في Supabase بعد التحويل: زر النسخ الاحتياطي يصدّره كاملاً، ويُعاد إدخاله.

## النسخ الاحتياطي

- خطة Supabase المجانية **بلا نسخ تلقائي**، والمشروع **يتوقف بعد 7 أيام بلا نشاط**.
- زر النسخ في الموقع (على Supabase) يصدّر **كل** الجداول بصيغة تُستعاد كما هي:
  `node scripts/migration/import-supabase.mjs --dir <مجلد الملف بعد فكّه>`.
- مقترح: نسخة يومية آلية (GitHub Actions + `pg_dump`) تبقي المشروع نشطاً أيضاً،
  وخطة Pro (25$/شهر) قبل الاعتماد الكامل: نسخ يومية تلقائية.
