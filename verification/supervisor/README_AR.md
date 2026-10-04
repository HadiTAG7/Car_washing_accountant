# تحقق المشرف عبر فرع GitHub التجريبي

الفرع: `feature/supervisor-emulator-validation`.
الأساس المراجع: `6527ec44ee085c1ab69c1b9d4470dec0b8bf4473` من فرع الإنتاج الرسمي `claude/laundry-accounting-dashboard-rtl-yyUBw`.

هذا الفرع للنقل إلى MASAH والتحقق المحلي فقط. أول commit يحتوي تعطيل نشر Vercel التلقائي لهذا الفرع وحده. لا دمج أو نشر أو تفعيل حسابات أو تعديل إنتاج. بوابة prebuild الأصلية لم تتغير. لا تشغل إجراءات GitHub اليدوية للنشر أو الصيانة.

الكود الأصلي للفرق موجود بالفعل في الفرع: لا تطبق patch مرة ثانية. `manifest.json` يثبت بصمات الملفات الـ26 وملفات القفل الثلاثة وتعطيل Vercel. يطلب preflight SHA المنشور الذي يمرره المنسق، ويتحقق من أن commit واحدًا فقط مبني على الأساس المراجع، ومن نظافة الملفات المتتبعة ونطاق التغييرات. استخدم checkout معزولًا عند SHA محدد، ولا تعتمد رأس فرع متحرك. افحص اختلاف رأس الإنتاج مع المنسق قبل أي عمل إنتاجي لاحق.

## أوامر MASAH

استبدل المتغيرات بمسارات محلية فعلية موجودة؛ مسارات السحابة ليست مسارات Windows. الأمر الأول يجلب هذا الفرع فقط إلى مرجع بعيد محلي. اختر مسار worktree جديدًا واحفظ عمل الآخرين. يمنع خيار autocrlf تحويل نهايات السطور حتى تتطابق البصمات على Windows.

```powershell
$repoPath = 'LOCAL_EXISTING_AUTHORIZED_REPOSITORY'
$checkRepo = 'LOCAL_NEW_ISOLATED_WORKTREE'
$testSha = 'PUBLISHED_TEST_COMMIT_SHA_FROM_COORDINATOR'
$cacheDir = 'LOCAL_EXISTING_FIREBASE_EMULATOR_CACHE'
$cliRoot = 'LOCAL_AUTHORIZED_FIREBASE_TOOLS_PACKAGE_ROOT'
$testOutput = 'LOCAL_NEW_TEST_OUTPUT_OUTSIDE_REPOSITORY'
git -C "$repoPath" fetch origin refs/heads/feature/supervisor-emulator-validation:refs/remotes/origin/feature/supervisor-emulator-validation
git -C "$repoPath" -c core.autocrlf=false worktree add --detach "$checkRepo" "$testSha"
$kitPath = Join-Path "$checkRepo" 'verification/supervisor'
python "$kitPath/preflight.py" --repo "$checkRepo" --expected-head "$testSha" --cache "$cacheDir" --cli-root "$cliRoot"
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed: stop; do not download or override anything.' }
python "$kitPath/run-tests.py" --repo "$checkRepo" --expected-head "$testSha" --cache "$cacheDir" --cli-root "$cliRoot" --output "$testOutput"
if ($LASTEXITCODE -ne 0) { throw 'Verification failed: inspect the local result log.' }
# أضف --storage فقط إذا كان runtime المطابق مثبتًا مسبقًا ومأذونًا.
```

الأدوات والتبعيات يجب أن تكون مثبتة مسبقًا في worktree المعزول وفق ملفات القفل، أو تهيئتها بتفويض منفصل. لا تنقل node_modules أو ملفات البيئة أو بيانات اعتماد من جهاز آخر. runner لا يثبت حزمًا ولا يستخدم npx ولا يسمح بتنزيل محاكي مفقود.

## المتطلبات والنتيجة المطلوبة

- Node >=20 وJava >=21. تحقق السحابة السابق استخدم Node 24.19.0، بينما Functions يعلن Node 20؛ لا ندعي فحص runtime الإنتاجي 20.
- Firebase CLI المسموح: 15.29.0 المتحقق في السحابة أو 15.32.1 المأذون على MASAH عبر `--cli-root`، بشرط تطابق بيانات المحاكي وبصمته. لا تغيير إصدار أو override للملف التنفيذي.
- Firestore 1.22.0 موجود مسبقًا: `cloud-firestore-emulator-v1.22.0.jar`، حجم 136707194 بايت؛ SHA256 في manifest. Storage 1.1.3 اختياري، حجم 52892936 بايت، وبصمته في manifest.
- 97 حالة أساسية: 46 لقواعد Firestore وREST، و51 للنقل عبر HTTP loopback وFunctions/Auth المحليين. الاختبارات جميعها يجب أن تنفذ وتنجح بلا تخطٍ. مع Storage تصبح 103 حالات.
- المشاريع صناعية `demo-sweater` و`demo-supervisor-rules` و`demo-supervisor-storage`؛ المنافذ تربط بـ127.0.0.1. قواعد Firestore الفعلية تحملها مجموعة القواعد صراحة؛ القواعد المفتوحة في firebase.test.json لخادم الاختبار ليست دليل صلاحيات.
- runner يولد adapter شبكيًا من الاختبار الأصلي دون تقليل تأكيداته، ويحفظ scratch مؤقتًا ثم ينظفه. لا يدعي اختبار استضافة Vercel الفعلية. يزيل إعدادات اعتماد Firebase من بيئة العمليات الفرعية، ولا يقرأ مخازن اعتماد الجهاز.

أعد للمنسق `preflight-result.json` و`emulator-run.log` و`target-results.json` بعد مراجعتها محليًا. لا ترفع هذه المخرجات إلى هذا الفرع تلقائيًا. التخطي أو العدد الأقل ليس نجاحًا. فشل الوصول أو غياب runtime يوقف الجولة؛ لا تجاوز 403 أو تسجيل دخول أو تغيير proxy.

نتائج الكود السابقة لنفس الملفات: lint صفر أخطاء وتحذيران قديمان؛ build ناجح؛ focused 218 نجاحًا؛ full 1816 نجاحًا و476 متخطى. اختبارات المحاكيات الأساسية والـStorage لم تنفذ في السحابة، ولا تُحسب جاهزة حتى يعيد MASAH نتيجة التنفيذ الفعلية. راجع `EXPECTED_BOUNDARIES_AR.md` و`EXCLUSIONS_AR.md` و`DEPLOYMENT_DECISION_AR.md` لحدود التغطية وعدم جاهزية النشر الإنتاجي.

لا تتضمن هذه الحزمة patch مكررًا أو لقطات أو سجلات خاصة أو أسرارًا أو node_modules. `dependencies.json` و`versions.json` هما بيانات أسماء وإصدارات فقط. أساس الفرع لا يضمن رأسًا رسميًا مستقبليًا.
