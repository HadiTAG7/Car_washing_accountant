import { describe, it, expect } from 'vitest';
import { paidByPartner, capitalBalanceOf, partnerPaidSummary } from '../partnerTotals';

const PAYMENTS = [
  { id: 'r1', partnerId: 'p1', amount: 20000, paymentDate: '2026-07-03' },
  { id: 'r2', partnerId: 'p1', amount: 5000,  paymentDate: '2026-08-01' },
  { id: 'r3', partnerId: 'p2', amount: 12000, paymentDate: '2026-08-02' },
];

describe('المدفوع من الشركاء يُشتق من الإيصالات', () => {
  it('يجمع لكل شريك من إيصالاته', () => {
    const t = paidByPartner(PAYMENTS);
    expect(t.get('p1')).toBe(25000);
    expect(t.get('p2')).toBe(12000);
  });

  it('شريك بلا إيصالات لا يظهر — ولا يُفترض له رصيد', () => {
    expect(paidByPartner(PAYMENTS).get('p9')).toBeUndefined();
    expect(paidByPartner([]).size).toBe(0);
  });

  it('يقبل الصف الخام كما يقبل المُهيّأ', () => {
    expect(paidByPartner([{ partner_id: 'p1', amount: 100 }]).get('p1')).toBe(100);
  });

  it('يتجاهل المبالغ غير الرقمية بدل أن ينتج NaN', () => {
    const t = paidByPartner([...PAYMENTS, { partnerId: 'p1', amount: 'غير رقمي' }]);
    expect(t.get('p1')).toBe(25000);
  });
});

describe('رصيد رأس مال الشريك من الدفاتر', () => {
  const entries = [
    { id: 'e1', status: 'posted' },
    { id: 'e2', status: 'draft' },
  ];
  const lines = [
    { entryId: 'e1', accountId: '3000-p1', debit: 0, credit: 20000 },
    { entryId: 'e2', accountId: '3000-p1', debit: 0, credit: 5000 },   // unposted
    { entryId: 'e1', accountId: '1010',    debit: 20000, credit: 0 },
  ];

  it('من القيود المرحّلة فقط', () => {
    expect(capitalBalanceOf('p1', entries, lines)).toEqual({ balance: 20000, available: true });
  });

  it('بلا دفاتر يعلن أنه غير متاح — فلا يُقرأ صفره كحقيقة', () => {
    expect(capitalBalanceOf('p1', [], [])).toEqual({ balance: 0, available: false });
  });

  it('يرصد الإيصالات التي لم تُرحّل بعد', () => {
    const s = partnerPaidSummary('p1', { payments: PAYMENTS, entries, lines });
    expect(s.paid).toBe(25000);            // the receipts win
    expect(s.ledgerBalance).toBe(20000);
    expect(s.unposted).toBe(5000);
  });

  it('وبلا دفاتر لا يُبلَّغ عن فرق وهمي', () => {
    const s = partnerPaidSummary('p1', { payments: PAYMENTS, entries: [], lines: [] });
    expect(s.paid).toBe(25000);
    expect(s.unposted).toBe(0);
    expect(s.ledgerAvailable).toBe(false);
  });
});
