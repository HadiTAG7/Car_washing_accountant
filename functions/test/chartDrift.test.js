/**
 * خريطتا أرقام الحسابات لا تنجرفان — الخادم والعميل يسمّيان الرقم نفسه
 * ═══════════════════════════════════════════════════════════════════════════
 * `functions/src/posting.js` لا يستورد من `src/` (شجرتا اعتمادية منفصلتان،
 * والخادم يُنشر وحده)، فلكلٍّ نسخته من `ACC`. وهذا يعمل ما دامتا متطابقتين —
 * ولم تكونا: نقص الخادمَ `3100` و`4100` و`5500` بصمت.
 *
 * ولماذا هذا خطرٌ لا ترتيب: `postEntry` يتحقق أن كل `accountId` موجودٌ في
 * دليل الحسابات المزروع من **نسخة العميل**. فرمزٌ يعرفه العميل ويجهله الخادم
 * يعني مسار ترحيلٍ خادمياً لا يستطيع تسمية حسابه أصلاً؛ ورمزٌ يعرفه الخادم
 * ويجهله العميل يعني قيداً يمرّ التحقق ثم يظهر في التقارير بلا اسم.
 *
 * فالادعاء الحامل: **مجموعتا المفاتيح والقيم متطابقتان حرفياً**. وأي حساب
 * يُضاف لواحدة يجب أن يُضاف للأخرى، وإلا سقط هذا الملف.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect } from 'vitest';
import { ACC as SERVER_ACC } from '../src/posting.js';
import { SOURCE_TYPES as SERVER_SOURCES } from '../src/invariants.js';
import { SOURCE_TYPES as CLIENT_SOURCES } from '../../src/lib/accounting/journal.js';
import { ACC as CLIENT_ACC, DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/accounting/chartOfAccounts.js';

describe('انجراف دليل الحسابات بين الخادم والعميل', () => {
  it('نفس المفاتيح تماماً — لا مفتاح في واحدة دون الأخرى', () => {
    expect(Object.keys(SERVER_ACC).sort()).toEqual(Object.keys(CLIENT_ACC).sort());
  });

  it('ونفس الأرقام لكل مفتاح — اسمٌ واحد لا يشير إلى حسابين', () => {
    for (const key of Object.keys(CLIENT_ACC)) {
      expect(SERVER_ACC[key], `${key} يختلف بين الخريطتين`).toBe(CLIENT_ACC[key]);
    }
  });

  it('وكل رمز في الخريطتين له صفٌّ فعلي في الدليل المزروع', () => {
    // الادعاء الأهم: رمزٌ بلا صفّ هو حسابٌ يرفضه `postEntry` عند الترحيل،
    // فيكتشفه المستخدم لحظة الحفظ لا لحظة الكتابة.
    const seeded = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => String(a.code)));
    for (const [key, code] of Object.entries(SERVER_ACC)) {
      expect(seeded.has(code), `${key} (${code}) ليس في DEFAULT_CHART_OF_ACCOUNTS`).toBe(true);
    }
  });

  it('وحسابات سويتر الأربعة موجودة ومصنَّفة صحيحاً', () => {
    const by = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [String(a.code), a]));
    // ذمم سويتر أصلٌ فرعي تحت الذمم — فيتجمّع في المركز المالي بلا سطر جديد.
    expect(by.get('1101')).toMatchObject({ accountType: 'asset', parentId: '1100', normalBalance: 'debit' });
    expect(by.get('4001')).toMatchObject({ accountType: 'revenue', normalBalance: 'credit' });
    // الخصم حسابٌ مقابل: مدين تحت إيراد سويتر، فيُرى الإجمالي والاقتطاع معاً.
    expect(by.get('4020')).toMatchObject({
      accountType: 'revenue', parentId: '4001', normalBalance: 'debit', contra: true,
    });
    expect(by.get('4110')).toMatchObject({ accountType: 'revenue', normalBalance: 'credit' });
  });

  it('وخصومات سويتر ليست حساب مردودات المبيعات — سببان مختلفان لا يُدمجان', () => {
    expect(CLIENT_ACC.SWEATER_DEDUCTIONS).not.toBe(CLIENT_ACC.SALES_RETURNS);
  });
});

describe('انجراف أنواع المصادر بين الخادم والعميل', () => {
  it('نفس القائمة تماماً', () => {
    // نوعٌ يعرفه أحدهما ويجهله الآخر: إمّا قيدٌ يرفضه الخادم بعد أن وعدت به
    // الشاشة، وإمّا قيدٌ يمرّ ولا تعرف الشاشة كيف تعرضه.
    expect([...SERVER_SOURCES].sort()).toEqual([...CLIENT_SOURCES].sort());
  });

  it('وأنواع سويتر الثلاثة موجودة', () => {
    for (const t of ['sweater_settlement', 'sweater_adjustment', 'sweater_collection']) {
      expect(SERVER_SOURCES, t).toContain(t);
      expect(CLIENT_SOURCES, t).toContain(t);
    }
  });
});
