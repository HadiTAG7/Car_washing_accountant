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

`service_role` يُستعمل في سكربتات النقل المحلية فقط، ولا يدخل الموقع ولا Vercel.

## أول دخول

المستخدمون يُنقلون بنفس الإيميل وبلا كلمة مرور. كل مستخدم:
1. يفتح الموقع ← «نسيت كلمة المرور» ← يكتب إيميله.
2. تصله رسالة «تعيين كلمة المرور — سويتر» ← يضغط الزر ← يختار كلمة مرور ← «حفظ».

الرسالة تحتاج SMTP في المشروع (بريد Supabase المدمج يرسل لأعضاء الفريق فقط).
إلى أن يُضبط: `node scripts/migration/first-login-links.mjs` يولّد لكل مستخدم رابطاً
خاصاً في `migration-data/first-login-links.md` يرسله المدير بنفسه (مرة واحدة،
صلاحية محدودة).

## التشغيل المتوازي (Vercel Preview)

متغيرات Preview في Vercel (Settings ← Environment Variables ← Preview، لفرع
`claude/supabase-migration` فقط):

| المتغير | القيمة | سرّي؟ |
|---|---|---|
| `VITE_DATA_SOURCE` | `supabase` | لا |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | لا |
| `VITE_SUPABASE_ANON_KEY` | المفتاح العام (anon / publishable) | لا |
| `DATA_SOURCE` | `supabase` | لا |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | لا |
| `LEDGER_DB_URL` | من `scripts/migration/server-role.mjs` | **نعم** |
| `SUPABASE_JWT_SECRET` | فقط إن كان المشروع يوقّع بـ HS256 | **نعم** |

الدوال في دبلن (`regions: ["dub1"]`) بجانب القاعدة في أيرلندا.

## التحويل النهائي (بعد موافقتك)

1. إعلان وقت التحويل، وإيقاف الإدخال في الموقع الحالي (لا تعديل في بيانات Firebase).
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
