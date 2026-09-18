/**
 * الشكل — ما يصل النموذج مضغوطٌ ومسمّى، ولا رقمٌ يُحسب هنا
 * Run: npm test --prefix mcp
 */
import { describe, it, expect } from 'vitest';
import {
  compactIncome, compactEntry, compactRecord, genericRecord, matchesQuery, accountRows, balanceOf,
} from '../src/shape.js';

describe('التقارير', () => {
  it('قائمة الدخل بعناوينٍ عربية وبنودٍ بالاسم، والأصفار محذوفة', () => {
    const is = {
      totalRevenue: 1000, totalCost: 300, grossProfit: 700, totalExpenses: 200, operatingProfit: 500,
      appliedFees: [{ label: 'رسوم الإدارة', rate: 0.1, amount: 50 }], netProfit: 450,
      revenue: [{ code: '4000', nameArabic: 'إيرادات الغسيل', amount: 1000 }],
      costOfServices: [{ code: '5000', nameArabic: 'عمولات', amount: 300 }],
      expenses: [{ code: '5200', nameArabic: 'الإيجار', amount: 200 }, { code: '5300', nameArabic: 'إدارية', amount: 0 }],
    };
    const c = compactIncome(is);
    expect(c.صافي_الربح).toBe(450);
    expect(c.تفصيل.مصروفات).toEqual([{ code: '5200', name: 'الإيجار', amount: 200 }]);
    expect(c.hasActivity).toBe(true);
    expect(JSON.stringify(c)).not.toContain('normalBalance');
  });
  it('accountRows مرتّبة بالأكبر، وbalanceOf على الجانب الطبيعي', () => {
    expect(accountRows([{ code: '1', nameArabic: 'أ', amount: 5 }, { code: '2', nameArabic: 'ب', amount: -50 }]).map((r) => r.code)).toEqual(['2', '1']);
    const tb = { rows: [{ code: '1010', debit: 500, credit: 120 }, { code: '2100', debit: 10, credit: 60 }] };
    expect(balanceOf(tb, '1010')).toBe(380);
    expect(balanceOf(tb, '2100', 'credit')).toBe(50);
    expect(balanceOf(tb, '9999')).toBe(0);
  });
});

describe('القيود والسجلات', () => {
  it('القيد يُسمّي حسابه ويحذف الداخلي', () => {
    const index = new Map([['1010', { nameArabic: 'الصندوق' }], ['4000', { nameArabic: 'الإيرادات' }]]);
    const e = { id: 'e1', entryNumber: 7, entryDate: '2026-08-11', periodKey: '2026-08', status: 'posted', sourceType: 'wash', sourceId: 'w1',
      description: 'غسلة', lines: [{ accountId: '1010', debit: 115, credit: 0 }, { accountId: '4000', debit: 0, credit: 115 }], createdAt: 'x' };
    const c = compactEntry(e, index);
    expect(c).toMatchObject({ number: 7, date: '2026-08-11', source: 'wash:w1', total: 115 });
    expect(c.lines[0]).toEqual({ account: '1010 الصندوق', debit: 115, credit: undefined });
    expect(c.createdAt).toBeUndefined();
  });
  it('الغسلة والمصروف والشريك بشكلٍ مقروء — و`user_id` لا يمرّ', () => {
    expect(compactRecord('washes', { id: 'w', wash_date: '2026-08-01', biker_name: 'خالد', quantity: 10, price: 11.5, status: 'مكتملة', payment_method: 'cash' }))
      .toMatchObject({ biker: 'خالد', total: 115, status: 'مكتملة' });
    expect(compactRecord('monthly_expenses', { id: 'm', expense_name: 'إيجار', total_monthly_cost: 3000, payment_day: 5, is_tax_invoice: true, created_at: 'x' }))
      .toMatchObject({ name: 'إيجار', total: 3000, paymentDay: 5, taxInvoice: true });
    const partner = compactRecord('partners', { id: 'p', partner_name: 'أحمد', workers_count: 3, user_id: 'uid-secret' });
    expect(partner).toEqual({ id: 'p', name: 'أحمد', workers: 3, status: 'active', linkedAccount: true });
    expect(JSON.stringify(partner)).not.toContain('uid-secret');
  });
  it('مجموعةٌ غير معروفة: يُحذف الداخلي وتُقصّر النصوص', () => {
    const g = genericRecord({ id: 'x', title: 'a'.repeat(300), created_at: 'now', payload: { big: true }, file_url: 'http://x', amount: 5 });
    expect(g.created_at).toBeUndefined(); expect(g.payload).toBeUndefined(); expect(g.file_url).toBeUndefined();
    expect(g.title.length).toBeLessThanOrEqual(120);
    expect(g.amount).toBe(5);
  });
  it('البحث نصّاً أو مبلغاً', () => {
    const row = { expense_name: 'فاتورة STC', supplier: 'الاتصالات', total_monthly_cost: 1150 };
    expect(matchesQuery(row, 'stc')).toBe(true);
    expect(matchesQuery(row, 'الاتصالات')).toBe(true);
    expect(matchesQuery(row, '1,150')).toBe(true);
    expect(matchesQuery(row, '1149')).toBe(false);
    expect(matchesQuery(row, 'زين')).toBe(false);
    expect(matchesQuery(row, '')).toBe(true);
  });
});
