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
  BookOpen, Scale, Lock, FileText, Boxes, Gauge, Wallet, TrendingUp, Bot,
} from 'lucide-react';

// Tab ids are untouched: the render chain below keys off them, so regrouping
// is a presentation change that cannot break a route.
export const TAB_GROUPS = [
  {
    id: 'top',
    title: null,
    tabs: [
      { id: 'overview',  label: 'نظرة عامة',              icon: LayoutDashboard },
      { id: 'agent_command_center', label: 'مركز قيادة الوكلاء', icon: Gauge, roles: ['admin', 'accountant'] },
    ],
  },
  {
    id: 'ops',
    title: 'التشغيل اليومي',
    tabs: [
      { id: 'washes',    label: 'الغسلات',                icon: Car         },
      { id: 'bikers',    label: 'البايكر',                 icon: Bike        },
      { id: 'housing',   label: 'السكن',                   icon: Home        },
      { id: 'temporary_expenses', label: 'المصروفات المؤقتة', icon: RefreshCw },
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

// ── ما يراه المستثمر ──────────────────────────────────────────────────────
// كان تبويباً واحداً: ورقةٌ طويلة تحمل أربعة أشياء مختلفة — حصّته، وسندات
// رأس ماله، وقائمة دخل الشهر، واتجاه ستة أشهر — فمن أراد رقماً واحداً مرّ
// على الثلاثة الأخرى، وعلى الجوال يعني ذلك تمريراً لا قراءة.
//
// الآن أربعة خيارات، مقسومةٌ بالسؤال الذي يجيب عليه كلٌّ منها لا بمصدر
// بياناته: «أين أنا؟» و«كم دفعتُ؟» و«ما نصيبي من هذا الشهر؟» و«إلى أين
// تتجه؟». والقسمة قسمةُ عرضٍ لا قسمةُ صلاحية: أربعتها تقرأ ما كانت تقرؤه
// الورقة الواحدة، لا حرفاً أكثر.
//
// و`view` تُحمل هنا لا في `App.jsx`: التبويب ومحتواه شيءٌ واحد، وفصلهما في
// ملفين يعني جدولين يفترقان بصمت عند أول إضافة.
export const INVESTOR_TABS = [
  { id: 'investor',         view: 'overview', label: 'نظرة عامة',    icon: Handshake  },
  { id: 'investor_capital', view: 'capital',  label: 'رأس مالي',     icon: Wallet     },
  { id: 'investor_income',  view: 'income',   label: 'قائمة الدخل',  icon: BarChart3  },
  { id: 'investor_trends',  view: 'trends',   label: 'اتجاه ٦ أشهر', icon: TrendingUp },
  // رابط MCP خاص بالشريك يلصقه في Claude أو ChatGPT — يُنشئه ويبدّله ويُلغيه
  // من هنا. القراءة بحصّته وحدها، من `api/partner-mcp/[secret].js`.
  { id: 'investor_assistant', view: 'assistant', label: 'المساعد الذكي', icon: Bot },
];

// المقصد حين لا يكون التبويب المطلوب من تبويبات المستثمر — ولأنه الأول،
// فهو أيضاً ما يفتح عليه أول دخول.
export const INVESTOR_HOME_TAB = INVESTOR_TABS[0].id;

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
export function resolveTab(activeTab, { investorMode = false } = {}) {
  const isInvestorTab = INVESTOR_TAB_IDS.includes(activeTab);
  if (investorMode) return isInvestorTab ? activeTab : INVESTOR_HOME_TAB;
  return isInvestorTab ? 'overview' : activeTab;
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
