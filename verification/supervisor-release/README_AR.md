# فحص مرشح المشرف على MASAH قبل الإنتاج

الأساس: `4fb12049614f5cfa4173b0d6b03d2659a82778e3`، ويتضمن تصحيح عمولة 4.50 والغسلات.
مرشح الإصدار المطلوب فحصه: `bca1c14c6bac3176653460e329cae7d9e55d8cb6`، commit واحد فوق الأساس، يغيّر 27 ملفًا للمشرف واختباراته فقط.
فرع نقل الحزمة: `feature/supervisor-release-masah`. رأسه يحتوي الحزمة وتعطيل نشر Vercel التلقائي لهذا الفرع وحده. **رأس النقل ليس مرشح الإنتاج**؛ لا تدمج الحزمة أو تعطيل الفرع في الإنتاج.

تفويض المالك الحالي يسمح بدمج واختبار المشرف ثم نشر Vercel وقواعد Firestore بعد تحقق الأمان وتنسيق الرأس مع المنسق. لا إنشاء أو تفعيل حساب أحمد، ولا Functions/Storage/Blaze أو تغييرات بيانات. هذه الحزمة تنفذ اختبارات محلية صناعية فقط، ولا تنشر شيئًا ولا تتصل بمشروع إنتاج.

## تشغيل موثق عند SHA محدد

استخدم مسارات MASAH الحقيقية وأدواته المثبتة والمأذونة. لا مسارات سحابة بدل Windows، ولا تنزيل محاكي أو حزم، ولا override أو تغيير شبكة أو تجاوز رفض وصول. يجب أن تكون الشجرتان جديدتين ومعزولتين، ولا تلمس عملًا متسخًا موجودًا.

```powershell
$repoPath = 'AUTHORIZED_EXISTING_REPOSITORY'
$kitRepo = 'NEW_ISOLATED_KIT_WORKTREE'
$sourceRepo = 'NEW_ISOLATED_SOURCE_WORKTREE'
$kitSha = 'PUBLISHED_KIT_SHA_FROM_COORDINATOR'
$candidateSha = 'bca1c14c6bac3176653460e329cae7d9e55d8cb6'
$cacheDir = 'EXISTING_VERIFIED_EMULATOR_CACHE'
$cliRoot = 'AUTHORIZED_INSTALLED_FIREBASE_TOOLS_ROOT'
$testOutput = 'NEW_OUTPUT_DIRECTORY_OUTSIDE_REPOSITORY'

git -C "$repoPath" fetch origin refs/heads/feature/supervisor-release-masah:refs/remotes/origin/feature/supervisor-release-masah
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed: stop.' }
git -C "$repoPath" -c core.autocrlf=false worktree add --detach "$kitRepo" "$kitSha"
if ($LASTEXITCODE -ne 0) { throw 'Kit checkout failed: stop.' }
git -C "$repoPath" -c core.autocrlf=false worktree add --detach "$sourceRepo" "$candidateSha"
if ($LASTEXITCODE -ne 0) { throw 'Source checkout failed: stop.' }
$kitPath = Join-Path "$kitRepo" 'verification/supervisor-release'
python "$kitPath/preflight.py" --repo "$sourceRepo" --expected-head "$candidateSha" --cache "$cacheDir" --cli-root "$cliRoot"
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed: stop; do not install, download or override.' }
python "$kitPath/run-tests.py" --repo "$sourceRepo" --expected-head "$candidateSha" --cache "$cacheDir" --cli-root "$cliRoot" --output "$testOutput"
if ($LASTEXITCODE -ne 0) { throw 'Tests failed: stop and return the reviewed result.' }
```

Node >=20، Java >=21، Firebase CLI 15.29.0 أو إصدار MASAH المأذون 15.32.1، وFirestore 1.22.0 بالبصمة المسجلة. حزم المصدر/functions مطلوبة مسبقًا وفق ملفات القفل؛ تهيئتها تحتاج القناة المأذونة المعتادة، ولا تنقل node_modules أو بيانات اعتماد من السحابة. `preflight` يتحقق من SHA والأساس والنظافة ونطاق الملفات وبصماتها والقفل؛ الحزمة منفصلة عن checkout المصدر.

## المطلوب تنفيذه بلا تخطٍ

**198 حالة** في 8 ملفات، تتحقق الحزمة من العدد لكل ملف ومن نجاح كل حالة:

- 99 للمشرف: 46 Firestore/REST و53 HTTP شبكي وFunctions/Auth محلي. زادت 97 السابقة بحالتي رفض عمليتي `sweaterPreviewImport` و`sweaterSaveOwnerHandoff`؛ لا يجوز إسقاطهما لبلوغ العدد القديم.
- 34 للرواتب والغسلات: 23 لاختبار الرواتب، 8 لسياسة عمولة 4.50 وحفظ التاريخ، و3 للحفظ الذري للغسلات دون إنتاج قيود/رواتب تلقائيًا.
- 65 لقواعد الأدوار القائمة: 60 للقواعد العامة، 3 لمركز القيادة المحلي الصناعي، و2 لعداد إعادة كلمة المرور. لا إرسال أحداث إنتاجية أو بريد فعلي.

كل نقاط المحاكيات تربط `127.0.0.1`، وكل معرفات المشاريع `demo-*`. الاختبار الشبكي يستعمل خادم HTTP loopback ويحتفظ بجميع تأكيدات الاختبار الأصلي؛ ليس دليلًا على تشغيل استضافة Vercel الحية. Functions هنا محاكي فقط، ولا يطلب Blaze ولا ينشر Firebase Functions. لا Storage في الحزمة أو قرار النشر.

أعد `preflight-result.json` و`emulator-run.log` و`target-results.json` بعد مراجعتها دون أسرار. التخطي أو العدد الأقل أو فشل ملف واحد ليس نجاحًا. لا إنتاج حتى تعود النتيجة ويتأكد المنسق من أن الرأس الرسمي لم يتغير ومن قناة نشر قواعد Firestore الموثقة.

## أدلة السحابة وحدودها

على مرشح المصدر نفسه: lint بلا أخطاء وتحذيران قديمان؛ build ناجح؛ الاختبار العام 1877 نجاحًا و478 متخطى. فحص 8 حالات متصفح و7 صور للمشرف ببيانات صناعية أعيد استخدامه لأن مصدر مكوناته وحسبته لم يتغير بدمج العمولة. لا جلسة إنتاجية للمشرف ولا حساب أحمد أثناء الفحص. مسار طلباته مثبت إلى `/api/ledger` باختبارات النقل؛ مصدر الغسلات والرواتب وتصحيح 4.50 محفوظ دون فرق عن الأساس.

CLI السحابة غير مسجل الدخول إلى Firebase؛ نشر القواعد يحتاج قناة موثقة لدى المنسق. بوابة `prebuild` الأصلية لم تتغير؛ لا تجاوز branch/SHA أو فشل التحقق. نتائج MASAH السابقة على a0f6794 لا تغطي هذا المرشح الجديد.
