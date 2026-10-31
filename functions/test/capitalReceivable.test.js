import { describe, expect, it } from 'vitest';
import { capitalReceivablePartner, capitalReceivables, splitPartnerReceipt, partnerReceiptCredits, capitalReceivableDescription } from '../src/capitalReceivable.js';

const partners = [{ id: 'p1', name: 'رباب' }, { id: 'p2', name: 'حسين  الغانم' }, { id: 'p3', name: 'علي' }, { id: 'p4', name: 'علي' }];
const line = (description, debit = 0, credit = 0, extra = {}) => ({ accountId: '1100', debit, credit, description, ...extra });

describe('«ذمة رأس مال غير مسددة»', () => {
  it('names the partner by the line’s partnerId, or by «ذمة رأس مال — الاسم» matching exactly one partner', () => {
    expect(capitalReceivablePartner(line('ذمة رأس مال — رباب'), partners)).toBe('p1');
    expect(capitalReceivablePartner(line('ذمة رأس مال - حسين الغانم'), partners)).toBe('p2');
    expect(capitalReceivablePartner(line('أي وصف', 0, 0, { partnerId: 'p1' }), partners)).toBe('p1');
    expect(capitalReceivablePartner(line('ذمة رأس مال — علي'), partners)).toBeUndefined();
    expect(capitalReceivablePartner(line('ذمة رأس مال — مجهول'), partners)).toBeUndefined();
    expect(capitalReceivablePartner(line('عميل'), partners)).toBeNull();
    expect(capitalReceivablePartner({ ...line('ذمة رأس مال — رباب'), accountId: '1101' }, partners)).toBeNull();
  });

  it('sums the open balance per partner and reports the lines no single partner owns', () => {
    const { byPartner, unmatched } = capitalReceivables([line('ذمة رأس مال — رباب', 20000), line('ذمة رأس مال — رباب', 0, 0.07, { partnerId: 'p1' }),
      line('ذمة رأس مال — علي', 50), line('عميل', 999)], partners);
    expect(byPartner.get('p1')).toBe(19999.93);
    expect(unmatched).toHaveLength(1);
  });

  it('credits the receivable first, never more than the receipt, then capital', () => {
    expect(splitPartnerReceipt(600, 1000)).toEqual({ receivable: 600, capital: 0 });
    expect(splitPartnerReceipt(1050, 1000.55)).toEqual({ receivable: 1000.55, capital: 49.45 });
    expect(splitPartnerReceipt(100, 0)).toEqual({ receivable: 0, capital: 100 });
    expect(splitPartnerReceipt(100, -5)).toEqual({ receivable: 0, capital: 100 });
    const credits = partnerReceiptCredits({ amount: 1050, outstanding: 1000, partnerId: 'p1', partnerName: 'رباب', capitalAccount: '3000-p1', capitalDescription: 'رأس مال شريك' });
    expect(credits).toEqual([{ accountId: '1100', debit: 0, credit: 1000, description: capitalReceivableDescription('رباب'), partnerId: 'p1' },
      { accountId: '3000-p1', debit: 0, credit: 50, description: 'رأس مال شريك' }]);
    expect(partnerReceiptCredits({ amount: 80, outstanding: 0, partnerId: 'p1', partnerName: 'رباب', capitalAccount: '3000-p1', capitalDescription: 'رأس مال شريك' }))
      .toEqual([{ accountId: '3000-p1', debit: 0, credit: 80, description: 'رأس مال شريك' }]);
  });
});
