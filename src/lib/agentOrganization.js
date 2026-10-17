// Display roster approved 16 October 2026. Stable ingress IDs are not renumbered.
// This is a read-only directory, not an expansion of the server sender allowlist.
const source = (id, name) => ({ id, name });
const ingress = source('agent-ingress', 'تقارير مركز القيادة');
const operations = source('sweater-operations', 'عمليات سويتر');
const quality = source('customer-experience', 'تقييمات وأدلة الجودة');
const profile = (number, id, title, icon, role, schedule, expectedSources, ingressSupported = true) => ({
  number, id, name: `${number}: ${title}`, shortName: `${number}: ${title}`, icon,
  role, schedule, expectedSources, ingressSupported,
  permissions: ['هذه الشاشة للمتابعة والقراءة فقط؛ لا تنفذ قرارات أو تغيّر سجلات.', 'التنفيذ خارج الشاشة وفق التفويض المعتمد للدور، دون صلاحيات إضافية.'],
});

export const AGENT_CATALOG = Object.freeze([
  profile(0, 'ceo', 'الرئيس التنفيذي', 'crown', 'يجمع نتائج المدراء ويعالج التعارضات ويرفع ملخصًا واحدًا والقرارات الضرورية فقط.', 'يوميًا 09:30 داخليًا و23:30 ملخص هادي — الرياض', [ingress], false),
  profile(1, 'cfo', 'المدير المالي', 'cfo', 'يتولى الإدارة المالية والمراجعة والترحيل المحدود والمطابقة؛ لا صرف أو عكس قيود من المركز.', 'يوميًا 23:00؛ السبت أوسع والمراجعة الشهرية يوم 13 — الرياض', [source('firestore-ledger', 'الدفتر المحاسبي'), ingress]),
  profile(2, 'expense-capture', 'تسجيل المصروفات', 'receipt', 'يسجل المصروفات غير المرحلة من مستندات مثبتة، يمنع التكرار ويحيل الاستثناءات للمدير المالي.', 'يوميًا 21:00 — الرياض', [source('google-drive', 'Google Drive'), source('expense-agent', 'مصروفات غير مرحلة')]),
  profile(3, 'tax-compliance', 'الضرائب والالتزام', 'shield', 'يجهز مسودة الضريبة ويطابقها مع المدير المالي؛ التقديم والدفع لهادي.', 'السبت 10:00؛ أول سبت من الشهر مراجعة أوسع — الرياض', [source('tax-documents', 'المستندات الضريبية')]),
  profile(4, 'operations-manager', 'مدير العمليات', 'workflow', 'يتولى مزامنة غسلات اليوم السابق ومنع التكرار واستحقاق العمولة غير المدفوعة ومتابعة الأصول؛ لا تحصيل.', 'يوميًا 00:00 و09:00؛ الاثنين للأصول والسبت مراجعة أوسع — الرياض', [operations, source('fixed-assets', 'سجل الأصول'), ingress]),
  profile(5, 'hr-manager', 'مدير الموارد البشرية', 'users', 'يدير الموارد البشرية وحساب الرواتب والأداء؛ تسجيل دفعة أو سلفة مؤكدة بطلب هادي الصريح فقط.', 'يوميًا 10:00؛ الرواتب يومي 1 و25 والأداء الثلاثاء — الرياض', [source('payroll', 'الرواتب'), source('people-operations', 'بيانات العاملين'), ingress]),
  profile(6, 'quality-manager', 'مدير الجودة', 'badge', 'يجمع البنود الثمانية وأدلة المتخصصين ويحسب الدرجة مرة واحدة، مع إظهار نقص التغطية.', 'يوميًا 11:00؛ الخميس مراجعة أوسع — الرياض', [quality, ingress]),
  profile(7, 'customer-ratings', 'تقييمات العملاء', 'badge', 'يحسب بنود جودة الغسيل والسلوك من تقييمات SSP الفعلية وحجم العينة؛ لا ينشر الدرجة النهائية.', 'يوميًا 10:00 — الرياض', [quality], false),
  profile(8, 'quality-customer-experience', 'الشكاوى والإلغاءات', 'clipboard', 'يتحقق من التيكتات والأدلة ونسبة الشكاوى والإلغاءات المنسوبة؛ لا يتواصل أو يعوض العميل.', 'يوميًا 10:00 — الرياض', [quality]),
  profile(9, 'execution-quality', 'مؤشرات التنفيذ', 'scale', 'يحسب الإنتاجية والتأخر والمدة وتحديث الحالة من الأدلة المعتمدة؛ لا يستنتج الحضور أو يكرر الاستيراد.', 'يوميًا 09:45 — الرياض', [operations, quality], false),
  profile(10, 'growth-manager', 'مدير النمو', 'trend', 'يشرح النمو والانكماش ومساهمة البايكرز بالأدلة ويرصد الخطر مبكرًا، مع فصل السبب المثبت عن الفرضية.', 'يوميًا 12:00؛ الاثنين أوسع والشهري أول اثنين بعد نهاية الشهر — الرياض', [source('commercial-performance', 'الأداء التجاري'), operations, ingress]),
  profile(11, 'system-engineering', 'مدير التقنية', 'settings', 'يشخص الأعطال ويصلح المأذون ويسلم التحقق المستقل لاختبار النظام؛ لا تجارب مالية إنتاجية.', 'يوميًا 09:15؛ السبت مراجعة أوسع — الرياض', [ingress], false),
  profile(12, 'system-testing', 'اختبار النظام', 'shield', 'يتحقق باستقلال من رحلة الأدمن والشريك وMCP والواجهة والجوال؛ حفظ تجريبي معزول فقط، دون كود أو نشر.', 'السبت 11:00 وعند تكليف تحقق محدد من مدير التقنية — الرياض', [ingress], false),
  profile(13, 'biker-attendance', 'تحضير البايكرز', 'users', 'يتابع تصويت تحضير الشمال ثم الاتصال والرسالة لغير المستجيب ويرفع الأسماء للمشرف ضمن التفويض.', 'السبت–الخميس 08:30، باستثناء الجمعة — الرياض', [source('whatsapp-attendance', 'تحضير واتساب')], false),
]);

// Old evidence stays attributed to its original role. Never replay it as a new
// manager run, or delete an unresolved record simply because a role was merged.
export const RETIRED_AGENT_OWNERS = Object.freeze({
  'expense-review': 'cfo', 'accounting-reconciliation': 'cfo',
  'sweater-sync': 'operations-manager', 'assets-maintenance-inventory': 'operations-manager',
  'payroll-workforce': 'hr-manager', 'people-performance': 'hr-manager',
  'commercial-growth': 'growth-manager',
});

export const COMMAND_CENTER_ROOT = Object.freeze({ id: 'ceo', name: '0: الرئيس التنفيذي', title: 'مركز القيادة' });
export const WORKFLOW_AGENT_IDS = Object.freeze(['expense-capture', 'cfo']);
export const AGENT_TEAMS = Object.freeze([
  { id: 'finance', name: 'فريق المالية', shortName: 'المالية', icon: 'landmark', leaderAgentId: 'cfo', memberAgentIds: ['expense-capture', 'tax-compliance'], layout: { angle: -90, memberArc: [-111, -69] } },
  { id: 'operations', name: 'فريق العمليات', shortName: 'العمليات', icon: 'workflow', leaderAgentId: 'operations-manager', memberAgentIds: [], layout: { angle: -30, memberArc: [] } },
  { id: 'growth', name: 'فريق النمو', shortName: 'النمو', icon: 'trend', leaderAgentId: 'growth-manager', memberAgentIds: [], layout: { angle: 30, memberArc: [] } },
  { id: 'quality', name: 'فريق الجودة', shortName: 'الجودة', icon: 'badge', leaderAgentId: 'quality-manager', memberAgentIds: ['customer-ratings', 'quality-customer-experience', 'execution-quality'], layout: { angle: 90, memberArc: [64, 90, 116] } },
  { id: 'people', name: 'فريق الموارد البشرية', shortName: 'الموارد البشرية', icon: 'users', leaderAgentId: 'hr-manager', memberAgentIds: ['biker-attendance'], layout: { angle: 150, memberArc: [150] } },
  { id: 'technology', name: 'فريق التقنية', shortName: 'التقنية', icon: 'settings', leaderAgentId: 'system-engineering', memberAgentIds: ['system-testing'], layout: { angle: 210, memberArc: [210] } },
]);
