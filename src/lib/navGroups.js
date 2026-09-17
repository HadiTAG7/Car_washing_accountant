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
  BookOpen, Scale, Lock, FileText, Boxes, Gauge,
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
// تبويبٌ واحد بلا عنوان مجموعة، فلا رأس طيٍّ يُعرض لقائمة من عنصر واحد.
// الشريط الجانبي هنا ليس اختصاراً بل حدّ: ما لا يظهر فيه لا يُفتح.
export const INVESTOR_GROUPS = [
  {
    id: 'top',
    title: null,
    tabs: [
      { id: 'investor', label: 'حسابي كشريك', icon: Handshake },
    ],
  },
];

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
