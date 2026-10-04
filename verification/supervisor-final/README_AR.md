# الفحص المتأثر الأخير قبل إصدار المشرف

مرشح الإنتاج: `d93d4ad4cbf18f95064f6afb8a56f5acb86c1aa7`، commit واحد للمشرف فوق رأس `2465461d961dca583c4eb7f353ce62573276dd40`. تصحيح accountBookings وعمولة 4.50 محفوظان، وجميع قيم ترجمة الرأس الجديد محفوظة. الفرق عن bca1 محصور في ملفات تصحيح accountBookings الستة.

حزمة النقل على `feature/supervisor-final-masah` مع تعطيل نشر هذا الفرع وحده. **رأس النقل ليس مرشح الإنتاج** ولا تدمج الحزمة أو تعطيل الفرع في الإنتاج. تحقق من SHA الحزمة المحدد الذي يمرره المنسق.

المنسق أكد MASAH198/198 بلا فشل أو تخطٍ على bca1 في 2026-10-04 20:18 UTC. يثبت `security-equivalence.json` مطابقة 22 ملفًا مصدرًا واختبارًا بايتًا ببايت. إعادة الاستخدام محدودة إلى 195 حالة: 99 للمشرف و31 للرواتب و65 للقواعد القائمة. لا يعاد استخدام نتيجة اختبارات الحفظ الذري الثلاثة تلقائيًا لأن staffHandoff/handoff تغيرا.

هذه الجولة **4 حالات Firestore فعلية فقط**: إعادة الحالات الثلاث الموجودة للحفظ الذري، وحالة صناعية إضافية لنطاق accountBookings تختبر حفظ السبعة مرة واحدة مع السباق/replay، بقاء isComplete:false وcompleted_with_gaps والتحذير، وغياب القيود ومسيرات الرواتب والمدفوعات. الحالة الإضافية لا تمثل حفظ الدفعة الإنتاجية لدى المنسق. لا ضرورة لإعادة مجموعة198 كاملة.

## MASAH

أدوات وتبعيات الاختبار السابقة المطابقة للقفل كافية. أعد استخدامها محليًا في checkout معزول دون تغيير الأشجار القائمة؛ لا نقل حزم/اعتمادات من السحابة، ولا ترقيات أو تنزيل محاكي أو تجاوز رفض الوصول. Node>=20 وJava>=21 وCLI15.29.0 أو15.32.1 المأذون، وFirestore1.22.0 بالبصمة المسجلة. لا Storage أو Functions emulator/deployment في هذه الجولة؛ Firestore emulator فقط.

```powershell
$repoPath = 'AUTHORIZED_EXISTING_REPOSITORY'
$kitRepo = 'NEW_ISOLATED_FINAL_KIT_WORKTREE'
$sourceRepo = 'NEW_ISOLATED_FINAL_SOURCE_WORKTREE'
$kitSha = 'PUBLISHED_FINAL_KIT_SHA_FROM_COORDINATOR'
$candidateSha = 'd93d4ad4cbf18f95064f6afb8a56f5acb86c1aa7'
$cacheDir = 'EXISTING_VERIFIED_EMULATOR_CACHE'
$cliRoot = 'AUTHORIZED_INSTALLED_FIREBASE_TOOLS_ROOT'
$testOutput = 'NEW_NONEXISTING_OUTPUT_DIRECTORY_OUTSIDE_REPOSITORY'
git -C "$repoPath" fetch origin refs/heads/feature/supervisor-final-masah:refs/remotes/origin/feature/supervisor-final-masah
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed: stop.' }
git -C "$repoPath" -c core.autocrlf=false worktree add --detach "$kitRepo" "$kitSha"
if ($LASTEXITCODE -ne 0) { throw 'Kit checkout failed: stop.' }
git -C "$repoPath" -c core.autocrlf=false worktree add --detach "$sourceRepo" "$candidateSha"
if ($LASTEXITCODE -ne 0) { throw 'Source checkout failed: stop.' }
$kitPath = Join-Path "$kitRepo" 'verification/supervisor-final'
python "$kitPath/preflight.py" --repo "$sourceRepo" --expected-head "$candidateSha" --cache "$cacheDir" --cli-root "$cliRoot"
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed: no download or override.' }
python "$kitPath/run-tests.py" --repo "$sourceRepo" --expected-head "$candidateSha" --cache "$cacheDir" --cli-root "$cliRoot" --output "$testOutput"
if ($LASTEXITCODE -ne 0) { throw 'Tests failed: return the reviewed result and stop.' }
```

يعزل runner بيانات الاعتماد وإعداد CLI، ويقصر كل الاتصال على127.0.0.1 ومشاريع demo-*، ويتحقق من4/4 بلا تخطٍ ومن العدد والحالة لكل ملف. أعد preflight-result.json وemulator-run.log وtarget-results.json بعد مراجعتها دون أسرار. لا يشغل نشرًا أو حسابًا أو بريدًا أو أحداث مركز القيادة أو دفعة إنتاجية.

الفحص المحلي الجديد على المرشح:175/175 في10 ملفات للتسليم/الحفظ/تحذير النطاق/i18n/النقل وحراسة المشرف وبوابة المصدر؛ lint صفر أخطاء وتحذيران قديمان؛ build ناجح. نتائج MASAHالمطابقة تخص نطاقها فقط، والفحص الرباعي لم ينفذ في السحابة لغياب Firestore runtime المتحقق.

لا production update_ref قبل نتيجة هذه الجولة وتنسيق الرأس مع المنسق. قناة نشر قواعد Firestore هي Consoleالموثق لدى المنسق، دون نقل credentials إلى هذا الخيط. إذن دمج/اختبار/نشر المشرف وقواعده قائم؛ لا إنشاء أو تفعيل حساب أحمد قبل إذن منفصل، ولا Functions/Storage/Blaze أو force.
