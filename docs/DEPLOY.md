# النشر — ماذا يُنشر، بأي ترتيب، وما الذي ينكسر إن عُكس

## بوابة مصدر Production

كل `npm run build` داخل بيئة Vercel Production يبدأ آليًا بالسكربت
`scripts/assert-production-source.mjs`. البوابة تسمح بالبناء فقط عندما يكون:

- اسم الفرع المرسل من Vercel هو `claude/laundry-accounting-dashboard-rtl-yyUBw`
  (عندما تتوفر بيانات الفرع).
- SHA البناء يطابق **بالضبط** رأس هذا الفرع في GitHub لحظة البناء.

لذلك يفشل البناء قبل إنشاء أي artifact إذا حاول فرع قديم، أو فرع ميزة، أو
checkout غير مدفوع إلى رأس الإنتاج استخدام هدف Production. الفحص يتجاوز
البناء المحلي وPreview، ويفشل مغلقًا إذا غابت هوية الـcommit أو تعذر إثبات
الرأس من GitHub. هذا لا ينشئ فرع `main` ولا يغير بيانات Firebase.

هذا المستند يصف نشر **`gemini-eed4a`**. الأوامر هنا تُنفَّذ من جهاز يملك
اعتماد Firebase — لا من داخل هذا المستودع وحده.

---

## ١ — ثلاثة أشياء تُنشر بثلاث آليات مختلفة

«انشر» ليست عمليةً واحدة هنا. `firebase.json` يعرّف ثلاثة أهداف، والتطبيق
نفسه ليس أحدها:

| ما هو | كيف يصل | يحتاج |
|---|---|---|
| `firestore.rules` | `firebase deploy --only firestore:rules` | حساب Firebase فقط |
| `functions/` (codebase **`ledger`**) | `firebase deploy --only functions:ledger` | خطة **Blaze** |
| الواجهة (`src/` → `dist/`) | `npm run build && npx cap sync android` ثم بناء APK | مفتاح توقيع Android |
| `storage.rules` | **لا يُنشر** | Cloud Storage غير مُفعَّل على المشروع |

> لا يوجد `hosting` في `firebase.json`. أصول الويب تُحزَم داخل الـ APK
> (`capacitor.config.json` → `webDir: "dist"`)، فلا شيء من الواجهة يصل
> بـ `firebase deploy`. تحديث الواجهة = إصدار APK جديد.

> `storage.rules` موجود في `firebase.json` لكن Cloud Storage غير مُفعَّل على
> المشروع، فـ `--only storage` يفشل. لذلك لا يذكره أي سكربت نشر هنا. إن
> فُعِّلت الخدمة لاحقاً، أضِف `storage` إلى `deploy:backend`.

---

## ٢ — المتطلبات

```bash
node --version          # 20.x — نفس ما تعلنه functions/package.json
firebase login          # مرة واحدة على الجهاز
firebase use            # يجب أن يطبع: gemini-eed4a (من .firebaserc)
```

لمشروع آخر: `firebase use <project-id>` أو `--project <project-id>` بعد كل
أمر أدناه.

---

## ٣ — الترتيب، والسبب

**الدوال أولاً، ثم القواعد، ثم التطبيق.** ليس ترتيباً اعتباطياً:

1. **الدوال أولاً — لأنها إضافة محضة.** استدعاء لا يناديه أحدٌ بعد لا يغيّر
   شيئاً. النسخة المثبَّتة على الأجهزة لا تعرف `startupAddEntry` ولا
   `authClaimFirstAdmin`، فنشرها لا يمسّ أحداً. لو نُشرت القواعد أولاً، لصارت
   الكتابات مرفوضة **قبل** وجود المسار البديل.

2. **القواعد هي النصف الكاسر.** هذا الفرع يُخرج `startup_costs` من الـ
   wildcard التشغيلي ويجعل:

   ```
   match /startup_costs/{id}      →  allow update: if false;  allow delete: if false;
   match /startup_cost_entries/{id} →  allow write: if false;
   ```

   أي APK ما زال يحمل النسخة القديمة يكتب هذين المستندين مباشرةً — وبعد نشر
   القواعد تُرفض كتاباته. **هذه ليست حالة يمكن تفاديها بترتيب أذكى**: إما
   قواعد قديمة تسمح بحالة البيانات التي أصلحها هذا العمل، وإما قواعد جديدة
   تكسر عميلاً قديماً. القول به أصدق من إخفائه.

3. **التطبيق بعدها مباشرةً.** القواعد الجديدة تفتح قراءة
   `startup_cost_entries` التي يحتاجها العميل الجديد، والعميل الجديد يستخدم
   الاستدعاءات بدل الكتابة المباشرة. فالاثنان يُصدَران معاً؛ وكل جهاز يبقى على
   الـ APK القديم يفقد إضافة/تعديل رسوم التأسيس حتى يُحدَّث. باقي التطبيق
   يعمل.

---

## ٤ — الأوامر

```bash
# المسار الكامل: يتحقق ثم ينشر — يتوقف عند أول فشل
npm run deploy
```

`npm run deploy` = `npm run verify` ثم `npm run deploy:backend`، و`verify`
هي: `lint` + `build` + `test` + `test:emulator` + `test:rules` +
`test:functions` + `test:callables`. تستغرق دقائق، وهذا هو المقصود: النشر
بلا بوابة هو تخمين.

وإن أردت الخطوات مفصولة، بالترتيب أعلاه:

```bash
npm run deploy:functions    # firebase deploy --only functions:ledger
npm run deploy:rules        # firebase deploy --only firestore:rules

npm run build && npx cap sync android
(cd android && ./gradlew assembleRelease)
```

`npm run deploy:backend` ينشر الاثنين معاً دون بوابة التحقق.

---

## ٤-ب — أو بضغطة زر من GitHub، بلا ترمنال

`.github/workflows/deploy.yml` ينشر من متصفحك. يعمل **يدوياً فقط** — لا مشغّل
على `push`، لأن النشر إلى مشروع إنتاج قرار لا أثر جانبي لدفع فرع.

### الإعداد، مرةً واحدة

**١) نزّل مفتاح خدمة**

Firebase Console ← ⚙️ **Project settings** ← تبويب **Service accounts** ←
**Generate new private key** ← **Generate key**. ينزل ملف `.json`.

> هذا الملف يعادل كلمة مرور إدارية على المشروع. لا يُرفع إلى المستودع ولا
> يُلصَق في محادثة — مكانه الوحيد هو أسرار GitHub المشفَّرة، وتقدر تبطله في
> أي لحظة من IAM.

**٢) أعطِ الحساب صلاحية النشر**

المفتاح المنزَّل يقرأ البيانات، لكنه لا ينشر افتراضياً. من
[Google Cloud Console ← IAM](https://console.cloud.google.com/iam-admin/iam)
ابحث عن الحساب المنتهي بـ `@<project-id>.iam.gserviceaccount.com` واضغط
✏️ **Edit principal** ← **Add another role**:

| ما تنوي نشره | الأدوار |
|---|---|
| القواعد فقط | `Firebase Rules Admin` |
| والدوال كذلك | + `Cloud Functions Admin` · `Cloud Run Admin` · `Artifact Registry Administrator` · `Cloud Build Editor` · `Service Account User` · `Service Usage Consumer` |

(اختصاراً: `Editor` + `Firebase Admin` يغطّيان الاثنين — أوسع، لكنه مقبول على
مشروع بمالك واحد.)

**٣) ألصق المفتاح في أسرار المستودع**

GitHub ← المستودع ← **Settings** ← **Secrets and variables** ← **Actions** ←
**New repository secret**

- **Name:** `FIREBASE_SERVICE_ACCOUNT`
- **Secret:** محتوى ملف الـ JSON **كاملاً** — من `{` الأولى إلى `}` الأخيرة

### التشغيل

> ⚠️ **الزر لا يظهر قبل أن يصل هذا الملف إلى الفرع الافتراضي.** GitHub لا يعرض
> `workflow_dispatch` إلا لسير عمل موجود في الفرع الافتراضي للمستودع
> (`claude/laundry-accounting-dashboard-rtl-yyUBw` هنا). فادمج الـ PR أولاً،
> ثم يظهر في تبويب Actions.

تبويب **Actions** ← **نشر إلى Firebase** ← **Run workflow** ← اختر:

| `target` | ماذا يفعل | يحتاج Blaze |
|---|---|---|
| `rules` | القواعد وحدها — يرفع «لا صلاحيات» عن الصفحات المحاسبية | لا |
| `functions` | الدوال وحدها | نعم |
| `rules+functions` | الاثنان | نعم |

`skip_tests` اتركها `false`: السير يشغّل lint وbuild وكل مجموعات الاختبار —
بما فيها محاكيات Firestore والدوال والمصادقة — **قبل** أن يلمس المشروع
الحقيقي، ويتوقف عند أول فشل فلا يُنشر شيء.

المفتاح يُكتب في ملف مؤقت داخل المشغّل ويُمحى في كل الأحوال، نجح النشر أو
فشل، ولا يُطبع في أي سجل. والنشر يمرّ بـ `--non-interactive` **بلا** `--force`،
فلو احتاج تأكيداً — حذف دالة اختفت من الشيفرة مثلاً — يتوقف ويسأل بدل أن
يحذف صامتاً.

---

## ٥ — ما تتحقق منه بعد النشر

| تحقّق | كيف |
|---|---|
| الاستدعاءات موجودة | Firebase Console ← Functions: يجب أن تظهر `startupAddEntry`، `startupDeleteEntry`، `startupConvertLegacySpend`، `startupUpdatePlan`، `startupDeletePlan`، `authBootstrapStatus`، `authClaimFirstAdmin` |
| القواعد وصلت | Console ← Firestore ← Rules: `allow update: if false` تحت `match /startup_costs/{id}` |
| الترحيل يعمل | في التطبيق: صفحة رسوم التأسيس ← إضافة مصروف ← يظهر القيد في دفتر الأستاذ بتاريخ الصرف لا بتاريخ الإنشاء |
| ضريبة المدخلات | تقرير الضريبة ← الحقل `1200` يقرأ `purchaseTaxSnapshot` المجمَّد لا نسبةً مفترضة |

الدوال تحتاج **Blaze**. على خطة Spark ينتهي `deploy:functions` برسالة
تطلب ترقية الخطة، ولا يُنشر شيء.

---

## ٥-ب — بلا Blaze: الخادم الموثوق على HTTP

Cloud Functions تحتاج خطة Blaze، وBlaze يحتاج حساب فوترة قد يُرفض — Google
يطلب أحياناً سجلاً تجارياً ورقماً ضريبياً. فإن انسدّ الباب الأول، الباب الثاني
مبنيّ.

`api/ledger.js` هو **نفس الخادم** لا نسخةً منه: يتحقق من التوكن ثم يسلّم إلى
`functions/src/handlers.js` — الملف الذي تسلّم إليه Cloud Functions أيضاً. لا
حارس مكرّر ولا قاعدة محاسبية ثانية. واختبار يفشل لو أُضيف معالج بلا حارس، أو
معالج لا يُصدَّر من `index.js`، أو رمز خطأ بلا حالة HTTP.

**والأمان مطابق:** الهوية من توكن Firebase يُتحقَّق منه بـ`verifyIdToken` (نفس
التحقق الذي تجريه Cloud Functions)، والدور يُعاد قراءته من `users/{uid}` على
الخادم لا من التوكن.

### النشر على Vercel

الواجهة مستضافة عليه أصلاً، فالـ API يصير على نفس النطاق — لا CORS ولا خدمة
ثانية.

1. **Vercel ← Settings ← Environment Variables:**
   - `FIREBASE_SERVICE_ACCOUNT` = محتوى مفتاح الخدمة JSON كاملاً
     (Firebase Console ← Project settings ← Service accounts ← Generate new private key)
   - `VITE_LEDGER_API_URL` = `/api/ledger`
2. أعِد النشر (Redeploy).

`VITE_LEDGER_API_URL` هو المفتاح كله: فارغاً يستعمل التطبيق Cloud Functions،
ومضبوطاً يحوّل **دالة واحدة** (`callLedger`) إلى HTTP ولا يعرف بقيةُ التطبيق
بأي باب مرّ. فالرجوع إلى Cloud Functions لاحقاً — لو نجح اشتراك Blaze — هو حذف
هذا المتغيّر.

> **تنبيه صادق:** شروط خطة Vercel المجانية (Hobby) تمنع الاستعمال التجاري،
> وخطة Pro بـ20$ شهرياً. وهذا ينطبق على استضافة الواجهة الحالية كذلك، فالـ API
> لا يفتح تعرّضاً جديداً — لكن القول به أولى من السكوت عنه.

### أو على مستضيف آخر

`api/ledger.js` معالج HTTP عادي. على Render أو Fly أو أي Node: غلّفه بـ
Express أو `http.createServer`، واضبط `VITE_LEDGER_API_URL` على عنوانه الكامل.
عيب الخطة المجانية في Render أن الخدمة **تنام بعد خمول**، فأول طلب في كل جلسة
يأخذ ~٥٠ ثانية — مقبول تقنياً، ثقيل عملياً.

---

## ٦ — أول مدير: افعلها **قبل** النشر، لا بعده

`authClaimFirstAdmin` يسمح لأول متصل مُصادَق بأخذ دور المدير **ما دام السجل
فارغاً تماماً** (لا `users` ولا `app_admins`). بين لحظة نشر الدوال وأول نقرة،
أي حساب مُصادَق في المشروع يستطيع أخذه.

**النافذة تُغلق بأن تسبقها.** أنشئ المستند يدوياً الآن — بلا نشر، بلا اعتماد،
بلا نافذة إطلاقاً:

> Firebase Console ← Firestore Database ← مجموعة `users` ← معرّف المستند =
> الـ uid الخاص بك (تجده في Console ← Authentication ← Users، ويعرضه شريط
> التنبيه في التطبيق مع زر نسخ) ← حقلان نصّيان:
> `role` = `admin` و `email` = بريدك.

بعدها يصير `directoryIsEmpty()` كاذباً إلى الأبد، فـ `authClaimFirstAdmin`
يرفض كل مطالبة — بما فيها مطالبتك أنت — ولا نافذة أصلاً. الزر يبقى في
الشيفرة لتثبيتٍ لاحق على مشروع فارغ.

وهذا أيضاً يحلّ «لا صلاحيات في كل صفحة» **بلا أي نشر**: المشكلة أن حسابك
يُصادِق ولا يملك مستند عضوية، والمستند اليدوي هو الحل كاملاً.

---

## ٧ — التراجع

**القواعد:** Console ← Firestore ← Rules ← تبويب السجل، وكل نشرة سابقة قابلة
للاستعادة بنقرة. أو `git checkout <sha> -- firestore.rules && npm run deploy:rules`.

**الدوال:** لا تراجع بنقرة. انشر الـ SHA السابق:

```bash
git checkout <previous-sha> -- functions/
npm run deploy:functions
git checkout HEAD -- functions/
```

**البيانات:** لا شيء هنا يحذف بيانات. `startupDeletePlan` يرفض ولا يُسلسِل
الحذف، والترحيل القديم (`startupConvertLegacySpend`) يكتب مستند صرف جديد
بمعرّف مشتق (`legacy__<parentId>`) — فإعادة تشغيله لا تُضاعف شيئاً.

---

## ٨ — ما لا يفعله هذا المستودع

**لا شيء يُنشر تلقائياً.** `deploy.yml` يعمل بـ `workflow_dispatch` وحده — لا
مشغّل على `push` ولا على دمج. دفع فرع لا يمسّ الإنتاج، وكل نشرة نيّة صريحة
لإنسان ضغط الزر.

**ولا يُنشر شيء بلا مفتاحك.** السير يفشل صراحةً إن كان `FIREBASE_SERVICE_ACCOUNT`
غير مضبوط، برسالة تقول أين يُضبط — لا يحاول ولا يفترض.

**والواجهة ليست جزءاً من أي نشر هنا.** أصولها داخل الـ APK، فتحديثها إصدارٌ
جديد يُبنى ويُوقَّع بمفتاح لا يدخل المستودع (`android/keystore.properties`
مستثنى في `.gitignore`).
