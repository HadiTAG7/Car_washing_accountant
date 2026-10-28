// ═══════════════════════════════════════════════════════════════════════════
// التنقّل — من يرى أي تبويب
// ═══════════════════════════════════════════════════════════════════════════
// أُخرِجت من `App.jsx` لأن قرار «من يرى ماذا» صار قراراً أمنياً لا ترتيباً
// بصرياً، وقاعدةٌ أمنية داخل مكوّنٍ يجرّ اثنتين وعشرين حزمة كسولة لا تُختبَر
// عملياً. هنا هي دالة نقيّة تُستدعى في سطر.
// ═══════════════════════════════════════════════════════════════════════════

import {
  LayoutDashboard, Landmark, Repeat, Receipt, Activity, Car, Bike, Home,
  BarChart3, Target, Handshake, Plug, HandCoins, RefreshCw, Percent,
  BookOpen, Scale, Lock, FileText, Boxes, Gauge, TrendingUp, Bot, CalendarDays,
} from 'lucide-react';

// Tab ids are untouched: the render chain below keys off them, so regrouping
// is a presentation change that cannot break a route.
const LEGACY_TAB_GROUPS = [
  {
    id: 'top',
    title: null,
    tabs: [
      { id: 'overview',  label: 'نظرة عامة',              icon: LayoutDashboard },
      { id: 'growth_performance', label: 'النمو وأداء البايكرز', icon: TrendingUp, roles: ['admin'] },
      { id: 'executive_reports', label: 'التقارير التنفيذية', icon: FileText, roles: ['admin'] },
      { id: 'agent_command_center', label: 'مركز قيادة الوكلاء', icon: Gauge, roles: ['admin', 'accountant'] },
    ],
  },
  {
    id: 'ops',
    title: 'التشغيل اليومي',
    tabs: [
      { id: 'today', label: 'اليوم', icon: CalendarDays, roles: ['admin', 'accountant'] },
      { id: 'quality_violations', label: 'الجودة والمخالفات', icon: Target, roles: ['admin'] },
      { id: 'fleet', label: 'الأسطول', icon: Bike, roles: ['admin', 'accountant'] },
      { id: 'washes',    label: 'الغسلات',                icon: Car         },
      { id: 'operations_reports', label: 'تقارير العمليات والأرشيف', icon: FileText, roles: ['admin'] },
      { id: 'bikers',    label: 'البايكر',                 icon: Bike        },
      { id: 'housing',   label: 'السكن',                   icon: Home        },
      { id: 'temporary_expenses', label: 'مصاريف الإدارة', icon: RefreshCw },
    ],
  },
  {
    id: 'sweater',
    title: 'منصة سويتر',
    tabs: [
      { id: 'sweater_settlements', label: 'تسويات سويتر',  icon: Handshake },
      { id: 'sweater_integration', label: 'تكامل سويتر',   icon: Plug      },
    ],
  },
  {
    id: 'expenses',
    title: 'المصاريف',
    tabs: [
      { id: 'startup',   label: 'رسوم التأسيس',           icon: Landmark    },
      { id: 'annual',    label: 'المصاريف السنوية',       icon: Repeat      },
      { id: 'monthly',   label: 'المصاريف الشهرية',       icon: Receipt     },
      { id: 'variable',  label: 'المصاريف المتغيرة',      icon: Activity    },
    ],
  },
  {
    id: 'reports',
    title: 'التقارير والرقابة',
    tabs: [
      { id: 'summary',   label: 'قائمة الدخل',            icon: BarChart3   },
      { id: 'vat',       label: 'الضريبة المستردة',       icon: Percent     },
      { id: 'budgets',   label: 'الرقابة والميزانيات',    icon: Target      },
    ],
  },
  {
    id: 'partners',
    title: 'الشركاء',
    tabs: [
      { id: 'partners',  label: 'إدارة الشركاء',          icon: Handshake   },
      { id: 'payments',  label: 'مدفوعات الشركاء',        icon: HandCoins   },
    ],
  },
  {
    id: 'books',
    title: 'الدفاتر المحاسبية',
    tabs: [
      { id: 'ledger',    label: 'دفتر الأستاذ',            icon: BookOpen    },
      { id: 'trial',     label: 'ميزان المراجعة',          icon: Scale       },
      { id: 'balance',   label: 'المركز المالي',           icon: Landmark    },
      { id: 'documents', label: 'المستندات الضريبية',      icon: FileText    },
      { id: 'assets',    label: 'الأصول الثابتة',          icon: Boxes       },
      { id: 'periods',   label: 'إقفال الفترة',            icon: Lock        },
    ],
  },
];

export const FINANCE_TAB_IDS = ['sweater_settlements', 'startup', 'annual', 'monthly', 'variable', 'temporary_expenses',
  'summary', 'vat', 'budgets', 'ledger', 'trial', 'balance', 'documents', 'assets', 'periods'];
const oldFinanceTabs = LEGACY_TAB_GROUPS.flatMap(group => group.tabs).filter(tab => FINANCE_TAB_IDS.includes(tab.id));
export const EXPENSE_TAB_IDS = ['startup', 'annual', 'monthly', 'variable', 'temporary_expenses'];
const financeTabs = [
  { id: 'finance', label: 'ملخص المالية', icon: Landmark, roles: ['admin'] },
  { id: 'finance_workbench', label: 'صندوق العمل المالي', icon: Receipt, roles: ['admin'] },
  { id: 'finance_reports', label: 'تقارير المالية والأرشيف', icon: FileText, roles: ['admin'] },
  { id: 'expenses', label: 'المصاريف', icon: Receipt, activeTabIds: EXPENSE_TAB_IDS },
  ...oldFinanceTabs.map(tab => EXPENSE_TAB_IDS.includes(tab.id) ? { ...tab, hidden: true } : tab),
  { id: 'finance_payroll', label: 'الرواتب ماليًا', icon: HandCoins, roles: ['admin'] },
];
const top = LEGACY_TAB_GROUPS[0];
export const TAB_GROUPS = [
  { ...top, tabs: ['overview', 'executive_reports'].map(id => top.tabs.find(tab => tab.id === id)) },
  { id: 'finance', title: 'المالية', homeTab: 'finance',
    sections: [
      { id: 'daily', title: 'الإدخال اليومي', tabIds: ['finance_workbench', 'expenses', 'sweater_settlements', 'finance_payroll'] },
      { id: 'statements', title: 'القوائم', tabIds: ['finance', 'summary', 'balance', 'trial', 'ledger', 'finance_reports'] },
      { id: 'tax-close', title: 'الضريبة والإقفال', tabIds: ['vat', 'documents', 'assets', 'budgets', 'periods'] },
    ], tabs: financeTabs },
  { id: 'partners', title: 'الشركاء', major: true, tabs: [
    { id: 'partners_list', label: 'قائمة الشركاء', icon: Handshake },
    { id: 'partner_payments', label: 'مدفوعات الشركاء', icon: HandCoins },
    { id: 'partner_capital', label: 'مطابقة رأس المال', icon: Scale, roles: ['admin', 'accountant'] },
    { id: 'partner_accounts', label: 'الحسابات والمساعد الذكي', icon: Bot, roles: ['admin'] },
  ] },
  { id: 'operations', title: 'العمليات', homeTab: 'operations_summary', sections: [
    { id: 'daily', title: 'المتابعة اليومية', tabIds: ['today', 'washes', 'quality_violations'] },
    { id: 'resources', title: 'الفريق والموارد', tabIds: ['bikers', 'housing', 'fleet'] },
    { id: 'performance', title: 'الأداء والتقارير', tabIds: ['operations_summary', 'growth_performance', 'operations_reports'] },
    { id: 'close', title: 'التكامل والإقفال', tabIds: ['sweater_integration', 'operations_close'] },
  ], tabs: [
    ...LEGACY_TAB_GROUPS.flatMap(group => group.tabs).filter(tab => ['today','washes','quality_violations','bikers','housing','fleet','growth_performance','operations_reports','sweater_integration'].includes(tab.id)),
    { id: 'operations_summary', label: 'ملخص العمليات', icon: Activity, roles: ['admin'] },
    { id: 'operations_close', label: 'إقفال شهر التشغيل', icon: Lock, roles: ['admin'] },
  ] },
  { id: 'management', title: null, tabs: top.tabs.filter(tab => tab.id === 'agent_command_center') },
];

// ── ما يراه المستثمر ──────────────────────────────────────────────────────
// ملخص رأس المال ضمن النظرة العامة، ورحلة رأس المال عرض مستقل.
// تبويبات الشريك تقسم العرض فقط ولا توسع صلاحيات القراءة.
//
// و`view` تُحمل هنا لا في `App.jsx`: التبويب ومحتواه شيءٌ واحد، وفصلهما في
// ملفين يعني جدولين يفترقان بصمت عند أول إضافة.
export const INVESTOR_TABS = [
  { id: 'investor',         view: 'overview', label: 'نظرة عامة',    icon: Handshake  },
  { id: 'investor_journey', view: 'journey',  label: 'رحلة رأس مالي', icon: Receipt    },
  { id: 'investor_income',  view: 'income',   label: 'قائمة الدخل',  icon: BarChart3  },
  { id: 'investor_trends',  view: 'trends',   label: 'اتجاه ٦ أشهر', icon: TrendingUp },
  // رابط MCP خاص بالشريك يلصقه في Claude أو ChatGPT — يُنشئه ويبدّله ويُلغيه
  // من هنا. القراءة بحصّته وحدها، من `api/partner-mcp/[secret].js`.
  { id: 'investor_assistant', view: 'assistant', label: 'المساعد الذكي', icon: Bot },
];

// المقصد حين لا يكون التبويب المطلوب من تبويبات المستثمر — ولأنه الأول،
// فهو أيضاً ما يفتح عليه أول دخول.
export const INVESTOR_HOME_TAB = INVESTOR_TABS[0].id;

export const SUPERVISOR_GROUPS = [{ id: 'top', title: 'حساب المشرف — قراءة فقط', tabs: [
  { id: 'overview', label: 'لوحة المشرف', icon: BarChart3 },
  { id: 'supervisor_data', label: 'بيانات العمل', icon: BookOpen },
] }];

export const INVESTOR_TAB_IDS = INVESTOR_TABS.map((t) => t.id);

// «نظرة عامة» بلا عنوان مجموعة كما في الواجهة الإدارية — الملخّص لا ينتمي
// لفئة — والبقية تحت عنوانٍ واحد يُطوى.
export const INVESTOR_GROUPS = [
  {
    id: 'top',
    title: null,
    tabs: [INVESTOR_TABS[0]],
  },
  {
    id: 'investor',
    title: 'حسابي كشريك',
    tabs: INVESTOR_TABS.slice(1),
  },
];

/** أيّ عرضٍ داخل `InvestorPage` يخصّ هذا التبويب. */
export function investorViewFor(tabId) {
  const tab = INVESTOR_TABS.find((t) => t.id === tabId);
  return (tab || INVESTOR_TABS[0]).view;
}

/**
 * التبويب الذي يُصيَّر فعلاً.
 *
 * الشريط الجانبي حدٌّ لا اختصار، فالحدّ يُطبَّق هنا مرة أخرى بدل الاتكال على
 * ما يُعرض: مستثمرٌ طلب `ledger` — بمعرّفٍ قديم في الحالة أو بيدٍ عابثة —
 * يعود إلى صفحته، لا إلى الدفاتر.
 *
 * والعكس كان ثقباً حقيقياً فتحه التقسيم: مديرٌ يحاكي شريكاً ينتقل بين
 * تبويبات المستثمر، فإذا أنهى المحاكاة بقي `activeTab` على معرّفٍ لا تصيّره
 * الواجهة الإدارية — شاشةٌ بيضاء. فيعود إلى «نظرة عامة».
 */
export const canonicalTabId = tab => tab === 'partners' ? 'partners_list' : tab === 'payments' ? 'partner_payments' : tab;

export function resolveTab(activeTab, { investorMode = false, allowedTabIds } = {}) {
  activeTab = canonicalTabId(activeTab);
  const isInvestorTab = INVESTOR_TAB_IDS.includes(activeTab);
  const fallback = investorMode ? INVESTOR_HOME_TAB : 'overview';
  const tab = investorMode
    ? (isInvestorTab ? activeTab : fallback)
    : (isInvestorTab ? fallback : activeTab);
  // A URL is user input, not an authorization decision. Unknown ids and tabs
  // hidden from this role must not mount a page (including its data hooks).
  if (allowedTabIds && !allowedTabIds.includes(tab)) return fallback;
  return tab;
}

/**
 * المجموعات التي يراها هذا المستخدم.
 *
 * الطيّ يُشتق من `isPartnerView` لا من الدور وحده، وهذا ما يجعل محاكاة
 * المدير أمينة لأول مرة: كانت تُغيّر `canMutate` والأرقام ولا تمسّ الشريط
 * الجانبي، فيرى المدير المحاكي تبويباً لا يراه الشريك أبداً — أي أن ما
 * يراجعه ليس ما يُسلَّم.
 *
 * و`localPreview` يعلو عليهما: أعلام المعاينة أدوات تطوير، وطيّها يجعلها
 * بلا فائدة.
 */
export function visibleGroupsFor({ role = null, isPartnerView = false, localPreview = false } = {}) {
  if (role === 'supervisor') return SUPERVISOR_GROUPS;
  if (localPreview) {
    return TAB_GROUPS
      .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => !tab.roles || tab.roles.includes('admin')) }))
      .filter((group) => group.tabs.length > 0);
  }
  if (isPartnerView) return INVESTOR_GROUPS;
  return TAB_GROUPS
    .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => !tab.roles || tab.roles.includes(role)) }))
    .filter((group) => group.tabs.length > 0);
}
