# التقارير التنفيذية — العقد الإداري v1

النطاق: ملخص يومي مؤرخ، متابعة القرارات ضمنه، وأسبوعية ضمن ملخص السبت. ليست لوحة تشغيل أو مصدر قيد/قبض/صرف. محتوى0 المراجع فقط؛ جلسة الأدمن القائمة هي سلطة الإدخال، وليست قيمة `reviewedByRole:0` تفويضًا.

## مسار الإدخال بواسطة0

من جلسة الأدمن المصرح بها: `?page=executive_reports` ← «إدخال تقرير إداري مراجع — للأدمن» ← «ملف التقرير». اختر ملفUTF-8JSON مطابقًا للعقد أدناه. يعرض المعاينة والتحذيرات والتاريخ قبل أي كتابة. ملف مرفوض لا يحفظ جزئيًا ولا يغير التقرير المقروء. لا نسخ/لصق من هادي ولا استخراجtoken أو تشغيل كود صفحة أو مفتاح جديد. يمكن لأداة المتصفح المصرح بها اختيار الملف منFileChooser. تعذر جلسة0 أو وسيلة اختيار الملف مانع دخول محدد، لا سبب لتوسيع صلاحياته.

بعد مراجعة المعاينة اضغط «حفظ التقرير الإداري». تعرض النتيجةreportId/revision/duplicate، ثم يقرأ التطبيق النسخة؛ لإغلاق قبول الحفظ يجب أيضًا قراءة النسخة من الخادم بعد إعادة تحميل صريحة ومطابقة المحتوى. لاauto-refresh. لا تضغطالحفظ أثناء عائق القراءة: الزر معطل إذا لم تنجح قراءةالأرشيف. لا تستخدمfixtureالتاريخية كأولإدخال حقيقي بعد إزالة وسمها فقط؛0يجهزمصدرًا فعليًا مراجعًا ومعتمدًا للعقد، دون إعادة تسليم قديم أو إخفاء وقت القطع.

## العقد الدقيق

المرجع القابل للتنفيذ: `src/lib/executiveReportContract.js`، كائنstrict؛ الحقول غير المذكورة مرفوضة، والحد64000بايت للتقرير. الأرقامJSONnumbersمحدودة finite، حتى3مؤشرات،100حالة،20تحذيرًا،20تفصيلًا،15تفصيلًا أسبوعيًا،40تغيرًا لكلحالة.

مثال اصطناعي للبنية فقط، ليس محتوى صالحًا للتسليم اليومي:

```json
{
  "schemaVersion": 1,
  "reportId": "ceo-digest-2026-10-18",
  "revision": 1,
  "dateRiyadh": "2026-10-18",
  "cutAtRiyadh": "2026-10-18T23:00:00+03:00",
  "title": "عنوان التقرير",
  "summary": "الخلاصة المراجعة عند القطع",
  "metrics": [],
  "visibleWarnings": [],
  "decisions": [],
  "weekly": {"status": "not_due_for_this_date", "text": "غير مستحقة لهذا التاريخ", "details": []},
  "ownerAction": {"requiredAtCut": false, "text": "الموقف عند القطع"},
  "provenance": {"sourceRef": "REVIEWED-SOURCE-ID", "reviewedByRole": 0, "sourceCutRiyadh": "2026-10-18T23:00:00+03:00"},
  "historicalIntegrity": "حدود اللقطة التاريخية",
  "details": []
}
```

- `reportId` ثابت `ceo-digest-YYYY-MM-DD` ويطابقdateRiyadh الصالح. `cutAtRiyadh` يجب أن يكون يوم التقرير نفسه،offset+03:00،غيرمستقبلي عندالحفظ؛ لا تضاف أدلة أحدث من القطع إلىالماضي. revision عددصحيح1–999999. revision>1يحتاج `correctionReason`غيرفارغ≤1500حرف.
- النصوص: title≤160،summary≤4000،historicalIntegrity≤1500،ownerAction.text≤1500. كل نص مطلوب غيرفارغ بعدtrim. `sourceRef`وid/caseId معرفاتASCII `[A-Za-z0-9_-]` من1–160؛ لا روابط محلية أو مستندات أوtokens.
- المؤشر: `{id,label,value,unit,coverage,asOfRiyadh?}`؛ label≤120،unit≤32،coverage≤600،value:finite number أوnull. المفقودnullوليسصفرًا،asOfRiyadhإنوجدISOولايتجاوزالقطع.
- التحذير: `{id,severity,text}`؛severity:limitation/open/critical،text≤1500. يبقى ظاهرًا في الأقسامالثلاثة.
- الحالة: `{caseId,priority,ownerRole,status,decision,evidenceLevel,next,history}`. priority1–3،ownerRole0–13. status:open_result_unverified/in_progress/blocked/awaiting_owner/verified_closed. decision≤2000،evidenceLevel≤100،next≤1500. اختياري:coordinationOwnerRole0–13،checkpointRiyadhISO،checkpointMeaning≤500،evidenceRefآمن،closure≤1500،verification،historyتبدأفارغة.
- verification:`{kind,reviewerRole,sourceRef,at}`؛kind:independent/owner/self. لاindependentبنفسownerRole، ولاتاريخأحدثمنالقطع. إغلاقverified_closedيحتاجverification؛نوعselfيبقىمعروضًاذاتيًاولايصبحمستقلًا. history:`[{at,text,sourceRef?}]`،text≤1500وكلat≤القطع.
- weekly:`{status,text,from?,to?,details}`؛text≤4000. includedمسموحةالسبتفقطمعfrom/toصالحينfrom≤to≤dateRiyadh. فيالسبتإماincludedأوunavailable،ليسnot_due. لاافتراضأسبوعيةمكتملةإنلميتوفرمحتواها.
- كلتفصيل:`{title,text,sourceRef?}`؛title≤160،text≤4000. لاHTMLتنفيذي أو رابطدخول أوPEM/Bearerأومراجعقرصمحلي. المحتوىيعرضReacttextولايستخدمdangerouslySetInnerHTML.

## مسار الخادم والنسخ

POST `/api/executive-reports`،AuthorizationBearerلجلسةمصرح بها،Cache-Controlprivate/no-store. لا GETعامةأومفاتيحجديدة. body:

- `{action:"list", before?:"YYYY-MM-DD"}`: حتى30عنوانتقرير،nextBeforeللصفحةالأقدم؛ لاتُقرأبياناتتشغيلأوكلالمحتوى.
- `{action:"read",reportId,revision?}`: report/currentRevision/history/historyLimited؛ آخر30بياننسخةفقط،والنسخةالمحددةلايعادحسابها.
- `{action:"save",report,expectedRevision}`: متاحللأدمنالحاليبعدverifyIdToken(token,true)وcallerRoleقبلأيقراءةتقرير،ثمإعادةنفسعضويتهداخلالtransaction. expectedRevision=report.revision−1. نفسه/نفسhashيرجعduplicatetrueبلاكتابة؛نسخةموجودةبمحتوىمختلف409؛رأسأحدثأوفجوة412. لااستبدالنسخأوحذف. مصدرالفاعلpublishedByUidمنالخادملاالملف.

نتيجةالحفظ:`{result:{reportId,revision,duplicate}}`. الأخطاء401/403/400/409/412/413/503 واضحة،والداخليةمنقحة؛توقفإذاالنتيجةغامضةواقرأقبلمحاولةالحفظمجدداً. يوجدحفظ ذري لرأسالفهرسولنسخةappend-onlyفينفسtransaction. المجموعةالإداريةexecutive_reports/ومسارrevisionsبلااختلاطبتقاريرالجودةأومركزالقيادة؛القواعدالحاليةتبقىdefault-denyلكلعميلمباشر،حتىالأدمن. لاRules/claims/Functions/جداولأعمالأوschemaمالي/تشغيليمعدلة.

## القبول

`npm run test:executive`اختباراتSDK/القواعدالفعليةفقطعلىdemo-sweater-executiveمعlocalhostemulator. لا تُنفذ علىProduction. اختبرالملفغيرالصالح،السعة،نسخةقديمة،التزامن،التكرار،القراءةبعدحفظجديد،رفضكلغيرأدمنومعاينةالشريك. ثم12يختبر360/390/1440والكيبوردوالأرشيفوالفلاتر. الفحصالحييبقىبعدعودةالمصدرالمسموحومنملف0حقيقي،لاfixtureأوReadyفقط. لا نشرFirebaseأوفوترةضمنالميزة.
