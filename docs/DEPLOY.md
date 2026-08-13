# النشر — ماذا يُنشر، بأي ترتيب، وما الذي ينكسر إن عُكس

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

لا يوجد سير عمل CI ينشر تلقائياً (`.github/workflows/` غير موجود)، وهذا مقصود:
النشر يحتاج اعتماداً على مشروع إنتاج، وإضافته إلى CI تعني وضع مفتاح خدمة في
أسرار المستودع. القرار قرارك، وهذا المستند يصف الطريق اليدوي بالكامل.
