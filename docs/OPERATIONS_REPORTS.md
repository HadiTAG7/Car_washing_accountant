# تقارير العمليات — العقد الإداري v1

المرجع التنفيذي `src/lib/operationsReportContract.js` والمثال الاصطناعي `server/__tests__/operationsFixture.js`؛ لا تنشر المثال كتقرير حقيقي. وافق هادي على التنفيذ في محادثة4، الرسالة01a15327-75d7-7813-bf47-7e709ffa7a3c بتاريخ19أكتوبر2026.

## الهوية والتاريخ

`reportId = ops-${dateRiyadh}-${sourceRole}-${kind}-${round}-${period.from}-${period.to}`. الأنواع morning_review/sync/assets/weekly/targeted. round معرفASCII ثابت≤24حرفًا:0900/2200/0000 أو معرف الجولة الأصلية التاريخية. لا تضف لاحقةعشوائية عند إعادة الحفظ؛ النوع/المصدر/الفترة/الجولة تمنع تصادم التقارير. التصحيح revision التالي معcorrectionReason وexpectedRevision=revision−1.

dateRiyadh تاريخ التقرير الأصلي،serviceDateRiyadh تاريخ التشغيل،period.from/to فترة الخدمة. to≤serviceDate≤dateRiyadh. cutAtRiyadh وقت حد الحقائق،issuedAtRiyadh وقت إصدار المصدر الأصلي؛ كلاهماISO+03:00،ولا تفترض وقتًا مفقودًا. review.at تاريخ مراجعة النشر/النقل،review.reviewerRole=4 وcompleted=true؛ هذه أوصاف مراجعة لا صلاحيات دخول. sourceRole/label يحفظان المصدر الأصلي،والناشر الفعلي من جلسةالخادم. الحفظ الفعليsavedAt من الخادم ويعرض منفصلًا عن القطع والمراجعة.

الحالي archiveMode=current يحتاجsourceRole=4 وقطعًا/إصدارًا وتوقيت مصادر/مؤشرات دقيقًا. الجولة2200 تحتاجsnapshot=partial؛لقطة المساء ليست إغلاق يوم. بقية اللقطاتbounded أوpartial ولا ادعاءاكتمال مطلق.

## التاريخي بلا اختلاق أوقات

archiveMode=historical_imported يتطلبhistoricalImported:

`{originalSourceRole,originalSourceRef,originalReportDate,sourceSha256,evidenceThroughDate,cutPrecision,timeNote}`.

originalSourceRole يساويsourceRole،originalReportDate يساويdateRiyadh،sourceRef معرفآمن وليس مسارقرص،sourceSha256 بصمة المصدر الأصلي64hex،evidenceThroughDate آخر يومحقائق موثق≥تاريخالتقرير. دقةcutPrecision:exact/date_only/approximate. عندexact يلزمقطع معلوم؛عندdate_only يمكنcutAtRiyadh=null،وعندapproximate يمكنnull أوالوقتالتقريبي معtimeNote صريح. issuedAtRiyadh وsources.checkedAt وmetrics.asOf تقبلnull للتاريخي فقط عند فقد الوقت؛لا تركيب00:00/23:59. النص المركب يجب تمييز إضافاته وتاريخها فيtimeNote وhistoricalIntegrity؛لا تنسب محتوى أضيف12أكتوبر إلى قطع11أكتوبر. ما لا يمكنتوثيق حدأدلته أوهويته يبقى بقائمةاستثناءات عند4.

تظهر علامة«أرشيف تاريخي منقول — ليس حالة التشغيل الحالية». الحالات النصية القديمة لا تغلق حالةحالية تلقائيًا. لا يعاداستيراد غسلة أوعمولة أوأصل أوأي معاملة أعمال.

## المحتوى

التاريخي فقط: يمكنserviceDateRiyadh وperiod.from/to أن تكونnull إذا لم يثبت نطاقالخدمة،مع شرحtimeNote؛المعرف يستخدمunknown للطرفالمفقود ولايوضع تاريخ الجولة بديلًا عنالخدمة. الحالي يبقىصارمًا. الدور الأصلي قد4/6/7/8/12 وفق المصدر لاوفق تخمين الترقيم الحالي؛sourceLabel وoriginalSourceRef يحفظان الاسم والمرجع الثابت. التقرير الإداري عنتعذرالفحص ليس إثباتفترةخدمةفُحصت.

title/summary/historicalIntegrity نصوص عربيةمراجعة. status=reviewed/partial/blocked تصف حالة التقرير. activity مفاتيح مستقلةread/previewed/saved/blocked؛كل منها{count:number|null,detail}. لا تجمعالمراحل المتداخلة كإجمالي. coverage فرديindividual وشركاتb2b كل منها{status:verified|partial|unavailable,detail}. التغطيةغيرالمتاحة ليستصفرًا.

metrics≤6:{id,label,value:number|null,unit,basis:operational|estimate|unavailable,coverage,asOf}. غيرالمتاحvalue=null. visibleWarnings≤30:{id,severity:limitation|open|critical,text} تبقى ظاهرةمعكلقسم. sources≤40:{id,label,sourceRef,checkedAt,coverage,status:verified|partial|unavailable}. cases≤100:{caseId,title,ownerRole,status:open|in_progress|blocked|awaiting_owner|verified_closed,evidence,next,lastVerifiedAt?,verification?}. الإغلاق يحتاجverification:{kind:self|independent|owner,reviewerRole,at,sourceRef}؛الذاتي لا يصبحمستقلًا. sections≤24:{id,title,text,columns?,rows?} والجداول≤8أعمدة/60صفًا؛المفقودnull. لاHTMLتنفيذي/أسرار/روابطMCPسرية/مساراتأقراص؛الحجم96KB.

لا مصدر/مؤشر/تحقق أحدثمنالقطعالدقيق؛للتاريخغيرالدقيق لا دليل بعدevidenceThroughDate،وتبقىالحدودصريحة. review.at قدتكونحاليةللأرشفة،ولا تجعلحقائقالتقريرحالية. أوقاتالمستقبل مرفوضةعندالحفظ.

## الخدمة والنشر

POST /api/operations-reports بأفعالlist/read/save،يتجهإلىhandlerمستقلداخلحاويةledgerالقائمةدونإضافةVercelFunctionأوتغييرخدماتالمالية/التنفيذي. collectionoperations_reports وrevisions/000001...؛لاSDKمباشرحتىالأدمن،قواعدdefault-denyالحاليةلاتتغير. adminحاليبالخادمقبلالقراءةوثانيةداخلالمعاملة؛sourceRoleليستسلطة.

samehash/samerevision→duplicate دون كتابة؛ اختلاف نفس النسخة409؛ نسخة متسابقة412. التصحيح append-only ولا استبدال أو حذف. رأس الفهرس والنسخة يحفظان بمعاملة ذرية.

`list` يدعم `page/pageSize/query/kind/status/sourceRole/from/to`: البحث في نصوص كامل الأرشيف، ثم الترقيم، دون حد إجمالي30. حجم الصفحة حتى30، والواجهة8. يبقى `before` للتوافق مع العملاء القديمة ولا يخلط مع الترقيم.

كل نسخة جديدة تحفظ `operationsSnapshot` من دوال الموقع على الخادم: غسلات أمس والشهر والشغالون من النظرة العامة، والخاملون من نفس تعريف تبويب الخاملين، وفرق سويتر من صفحة اليوم عند تطابق القطع، وإلغاءات البايكر من لقطة المؤشرات. الشهر ووقت القراءة مستقلان عن قطع النص؛ خصوصًا عند نشر تقرير متأخر أو تاريخي. الأرقام غير المتاحة null، ولا يؤخذ شيء من نص الوكيل. الحقل ملك الخادم؛ يعزل عند مطابقة طلب الناشر وإعادة القراءة. إعادة الطلب لا تعيد الالتقاط، والقراءة لا تضيف لقطة إلى تقرير قديم.

المصدر الحالي للنص هو ملف JSON المراجع من الوكيل، سواء رفعه من الصفحة أو عبر أداة النشر. الصفحة القديمة عرضت النص مباشرة ولم تحذف مسافاته. القواعد المشتركة في [REPORT_WRITING_RULES.md](REPORT_WRITING_RULES.md)، ونقطة تعليمات الوكلاء خارج المستودع موثقة فيه. العرض لصاحب المشروع يعزل الأكواد والجولات والتغطية والمصادر داخل التفاصيل المطوية، مع الأصل المحفوظ كاملًا. فحص الصياغة تنبيه لا رفض.

النشر يقرأ السجلات الموجودة فقط؛ لا يتصل بسويتر ولا يعدل غسلة أو عمولة أو أصلًا أو مالًا أو حالة مسير.

MCPsweater_operations_reports وsweater_publish_operations_report فيالاتصالالقائم،الناشريحفظثم يعيدقراءةالنسخةويطابقها. UIرفعJSONومعاينةوحفظبنفسالخدمةبديلمدعومعندتأخركتالوجالأدوات. غموضالحفظ لايعنيالفشل؛قراءةصريحةقبلمحاولةإعادةالحفظ. لاauto-refresh/reload/save.

القبول: فحوصمعزولةللهويةوالحفظوالتكراروالتصحيحوالتزامنوالقواعدوالقراءة،ثم12للعربيةوالجوالوالتصفيةوالنسخ،ثمReady+commit+النطاقوالقراءةالحية.4ينشرالتقريرالحقيقيالمراجعويطابقه بعدإعادةتحميلصريحةثم ينقلالأرشيفالمتحقق؛لايدعي11أنالمحتوىمنشورقبلدليلقبول4. لا تغييرنموذج/مواعيد/إخطارات/مرسلالمزامنةأوقواعدFirebase.
