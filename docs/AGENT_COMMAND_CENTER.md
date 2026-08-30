# مركز قيادة الوكلاء

## النطاق الأمني

مركز القيادة سطح مراقبة للمدير والمحاسب فقط. متصفح التطبيق يقرأ مجموعات `agent_command_*` ولا يكتب فيها مطلقًا. كل إدخال خارجي يمر عبر Vercel Function على `/api/agent-command-center-ingest`، بينما تمنع قواعد Firestore الكتابة المباشرة حتى من حساب المدير.

الدالة لا تستدعي أي وظيفة ترحيل ولا تكتب في مجموعات المحاسبة أو التشغيل. حدث `approval` يعني «طلب موافقة معلّق» فقط؛ لا ينفذ القرار ولا يغير حالته إلى معتمد.

## الهيكل التنظيمي

`CEO / مركز القيادة` عقدة تنظيمية عليا وليست وكيلًا ولا تدخل في العد. سجل الفرق في الواجهة يربط خمس عقد تنظيمية بقائد وكيل وأعضاء، ويحافظ على إجمالي 15 وكيلًا. عقد الفرق وCEO منفصلة عن سجل الوكلاء ولا تدخل في العدد. إضافة فريق أو قائد أو أعضاء مستقبلًا تتم بتحديث السجل بدل إعادة كتابة الرسم.

التسلسل التنظيمي هو:

- المالية: `cfo` يقود `expense-capture` و`expense-review` و`accounting-reconciliation` و`tax-compliance`.
- العمليات: `operations-manager` (COO) يقود `sweater-sync` و`assets-maintenance-inventory`.
- الموارد البشرية: `hr-manager` (CHRO) يقود `payroll-workforce` و`people-performance`.
- الجودة وتجربة العميل: `quality-manager` (CQO) يقود `quality-customer-experience`.
- النمو التجاري: `growth-manager` (CGO) يقود `commercial-growth`.

مسار المصروفات هو `expense-capture → expense-review → accounting-reconciliation → cfo` داخل فريق المالية، ثم يرفع CFO الملخص إلى CEO. وبقية التقارير تتبع المسار نفسه: الوكيل التنفيذي ← مدير القسم ← CEO. تعرض لوحة المدير تقارير أعضاء فريقه والتنبيهات الحرجة وطلبات الموافقة المرفوعة منهم، فيما تبقى جميع التنبيهات والطلبات ظاهرة في تجميع CEO. هذا التجميع عرض مشتق للقراءة فقط؛ لا ينسخ الحدث ولا يغير نسبته إلى الوكيل الأصلي ولا ينفّذ أي قرار.

## إعداد السر

أنشئ المتغير الحساس `AGENT_COMMAND_CENTER_WEBHOOK_SECRET` في إعدادات مشروع Vercel بقيمة عشوائية قوية، وامنح قيمته للمرسل الموثوق عبر قناة أسرار خارج المستودع. أضف أيضًا `AGENT_COMMAND_CENTER_FIREBASE_SERVICE_ACCOUNT` كـJSON لحساب خدمة مخصص للمدخل و`AGENT_COMMAND_CENTER_FIREBASE_PROJECT_ID=gemini-eed4a`. إذا كان المشروع يحتوي أصلًا على المتغير الخادمي `FIREBASE_SERVICE_ACCOUNT` فيمكن للدالة إعادة استخدامه، مع تفضيل المتغير المخصص عند توفره. لا تستخدم متغيرًا يبدأ بـ `VITE_` ولا تضع القيم في ملفات الواجهة أو Git.

يوفر المستودع مرسلًا تشغيليًا لا يخزن السر ولا يطبعه. بعد وضع السر في بيئة المشغّل، أرسل ملف حدث صالحًا هكذا:

```text
npm run agents:send -- path/to/event.json
```

يُشتق مفتاح منع التكرار افتراضيًا من الجسم الخام، ويمكن للمشغّل تثبيته صراحةً عبر `AGENT_COMMAND_CENTER_IDEMPOTENCY_KEY`. ويمكن تغيير عنوان الدالة عبر `AGENT_COMMAND_CENTER_ENDPOINT` عند استخدام مشروع آخر.

## توقيع الطلب

الطلب `POST` فقط، بحجم أقصى 128 KiB، ويحمل ثلاثة رؤوس:

- `X-Sweater-Timestamp`: وقت Unix بالثواني. يقبل الخادم فرقًا أقصاه خمس دقائق.
- `X-Sweater-Idempotency-Key`: معرّف ثابت للمحاولة المنطقية نفسها، بطول أقصى 128 حرفًا.
- `X-Sweater-Signature`: `sha256=<hex>` حيث `hex` هو HMAC-SHA256 للنص الثنائي التالي دون إعادة تنسيق JSON:

```text
<timestamp>.<idempotency-key>.<raw-request-body>
```

إعادة الطلب بنفس مفتاح منع التكرار ترجع نجاحًا مع `duplicate: true` ولا تنشئ نشاطًا أو تقريرًا أو سجل تدقيق ثانيًا.

## أنواع الأحداث

كل جسم يبدأ بهذه الحقول:

```json
{
  "version": 1,
  "eventType": "status",
  "agentId": "expense-capture",
  "occurredAt": "2026-08-28T09:00:00.000Z"
}
```

المعرّفات المقبولة للوكلاء:

```text
expense-capture
expense-review
accounting-reconciliation
sweater-sync
cfo
operations-manager
hr-manager
quality-manager
growth-manager
assets-maintenance-inventory
payroll-workforce
people-performance
tax-compliance
quality-customer-experience
commercial-growth
```

لا يقبل الخادم معرفًا حرًا؛ `ceo` ومعرّفات عقد الفرق وأي معرف غير موجود في القائمة تُرفض حتى لو كان الطلب صحيح التوقيع.

### أمثلة أحداث المديرين

حالة تشغيل مدير العمليات تستخدم العقد الحالي نفسه دون حقول إضافية:

```json
{
  "version": 1,
  "eventType": "status",
  "agentId": "operations-manager",
  "occurredAt": "2026-08-28T09:30:00.000Z",
  "status": "warning",
  "isRunning": true,
  "lastRunAt": "2026-08-28T09:29:00.000Z",
  "sourceIds": ["sweater-operations", "fixed-assets", "agent-ingress"]
}
```

ويرفع مدير الموارد البشرية تقريره إلى CEO كحدث `report` عادي، ويبقى مجرد تقرير لا ينفذ تغييرًا على الرواتب أو الموظفين:

```json
{
  "version": 1,
  "eventType": "report",
  "agentId": "hr-manager",
  "occurredAt": "2026-08-28T09:35:00.000Z",
  "report": {
    "title": "ملخص الموارد البشرية",
    "summary": "ملخص قائم على التشغيل الفعلي ومهيأ لمراجعة CEO."
  }
}
```

يستخدم `quality-manager` و`growth-manager` أنواع الأحداث نفسها وبالبنية نفسها. ولا تتغير عقود الوكلاء الأحد عشر السابقة.

### حالة تشغيل

```json
{
  "version": 1,
  "eventType": "status",
  "agentId": "expense-capture",
  "occurredAt": "2026-08-28T09:00:00.000Z",
  "status": "healthy",
  "isRunning": false,
  "lastRunAt": "2026-08-28T08:58:00.000Z",
  "nextRunAt": "2026-08-28T10:00:00.000Z",
  "sourceIds": ["google-drive", "expense-agent"]
}
```

قيم الحالة: `healthy`, `warning`, `critical`, `unknown`.

### تقرير

```json
{
  "version": 1,
  "eventType": "report",
  "agentId": "expense-review",
  "occurredAt": "2026-08-28T09:05:00.000Z",
  "report": {
    "title": "مراجعة المصروفات",
    "summary": "وصف موجز قائم على نتيجة التشغيل الفعلية."
  }
}
```

### تنبيه

```json
{
  "version": 1,
  "eventType": "alert",
  "agentId": "accounting-reconciliation",
  "occurredAt": "2026-08-28T09:10:00.000Z",
  "alert": {
    "title": "فرق يحتاج مراجعة",
    "message": "تفاصيل الاستثناء دون أسرار أو بيانات دخول.",
    "severity": "warning"
  }
}
```

قيم شدة التنبيه: `info`, `warning`, `critical`.

### طلب موافقة

```json
{
  "version": 1,
  "eventType": "approval",
  "agentId": "tax-compliance",
  "occurredAt": "2026-08-28T09:15:00.000Z",
  "approval": {
    "title": "قرار بشري مطلوب",
    "summary": "ما يحتاج أن يراجعه صاحب الصلاحية.",
    "dueAt": "2026-08-29T12:00:00.000Z"
  }
}
```

### صحة مصدر بيانات

يمكن لحدث `source` أن يكون عامًا أو مرتبطًا بوكيل عبر `agentId`:

```json
{
  "version": 1,
  "eventType": "source",
  "occurredAt": "2026-08-28T09:20:00.000Z",
  "source": {
    "id": "google-drive",
    "name": "Google Drive",
    "status": "healthy",
    "details": "آخر فحص مكتمل.",
    "lastCheckedAt": "2026-08-28T09:19:00.000Z"
  }
}
```

### نشاط عام

```json
{
  "version": 1,
  "eventType": "activity",
  "occurredAt": "2026-08-28T09:25:00.000Z",
  "activity": {
    "message": "اكتمل فحص الاتصال بالمصادر.",
    "kind": "success"
  }
}
```

## رابط المحادثة

يمكن لحدث وكيل أن يحمل `conversationUrl`، لكن الخادم والواجهة لا يقبلان زر «فتح المحادثة» إلا لرابط HTTPS على `chatgpt.com` أو `chat.openai.com`. غياب الرابط أو رفضه يظهر كحالة صريحة، ولا يولّد رابطًا تخمينيًا.

## سجل التدقيق والاحتفاظ

كل حدث جديد ينشئ سجلًا في `audit_logs` يتضمن نوع الحدث ومعرّف الوكيل وهاش مفتاح منع التكرار فقط. لا يسجل التوقيع أو السر أو جسم الطلب الخام. مجموعة `agent_command_ingestion` خاصة بالخادم ولا يمكن قراءتها من العميل، وتحمل مؤشراتها `expiresAt` بعد 90 يومًا.

لأن TTL المدار يتطلب فوترة Firestore، يشغّل Vercel المسار المحمي `/api/agent-command-center-cleanup` يوميًا عند `01:15 UTC`. يتحقق المسار من `Authorization: Bearer <CRON_SECRET>` قبل فتح اتصال Firestore، ثم يحذف بحد أقصى 400 مؤشر منتهي في التشغيل الواحد ولا يقرأ أو يحذف أي مجموعة أخرى. يرسل Vercel هذا الرأس تلقائيًا عندما يكون `CRON_SECRET` مضبوطًا في بيئة الإنتاج.
