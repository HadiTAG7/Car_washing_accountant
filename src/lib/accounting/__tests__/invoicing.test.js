import { describe, it, expect } from 'vitest';
import {
  formatDocumentNumber, invoiceTotals, tlv, buildZatcaQrPayload, validateQrFields,
  decodeZatcaQrPayload, buildSimplifiedInvoice, buildCreditNote, buildDebitNote,
  documentSign, INTEGRATION_STATUS,
} from '../invoicing';
import { counterIdFor, sourceClaimId, sequenceGaps } from '../firestoreInvoicing';
import { round2 } from '../journal';

const SELLER = { name: 'شركة هادي الغانم', vatNumber: '300000000000003', address: 'الرياض' };

describe('ترقيم المستندات', () => {
  it('يبني رقماً مقروءاً مسبوقاً بنوع المستند وسنته', () => {
    expect(formatDocumentNumber('invoice', 2026, 42)).toBe('INV-2026-000042');
    expect(formatDocumentNumber('credit_note', 2026, 1)).toBe('CRN-2026-000001');
    expect(formatDocumentNumber('debit_note', 2025, 999999)).toBe('DBN-2025-999999');
  });

  it('لكل نوع وسنة عدّاد مستقل', () => {
    expect(counterIdFor('invoice', 2026)).toBe('documents-invoice-2026');
    expect(counterIdFor('credit_note', 2026)).not.toBe(counterIdFor('invoice', 2026));
    expect(counterIdFor('invoice', 2025)).not.toBe(counterIdFor('invoice', 2026));
  });

  it('مفتاح المصدر يمنع إصدار مستندين لنفس السجل', () => {
    expect(sourceClaimId('wash', 'w1')).toBe('wash__w1');
    expect(sourceClaimId('wash', 'w1')).toBe(sourceClaimId('wash', 'w1'));
    expect(sourceClaimId('wash', 'w1')).not.toBe(sourceClaimId('expense', 'w1'));
  });
});

describe('كشف الفجوات في التسلسل', () => {
  it('يرصد رقماً مفقوداً', () => {
    const report = sequenceGaps([
      { type: 'invoice', year: 2026, sequence: 1, documentNumber: 'INV-2026-000001' },
      { type: 'invoice', year: 2026, sequence: 3, documentNumber: 'INV-2026-000003' },
    ]);
    expect(report[0].missing).toEqual([2]);
  });

  it('يرصد رقماً مكرراً — أخطر من المفقود', () => {
    const report = sequenceGaps([
      { type: 'invoice', year: 2026, sequence: 1, documentNumber: 'INV-2026-000001' },
      { type: 'invoice', year: 2026, sequence: 1, documentNumber: 'INV-2026-000001' },
    ]);
    expect(report[0].duplicates).toEqual([1]);
  });

  it('يفصل السلاسل عن بعضها', () => {
    const report = sequenceGaps([
      { type: 'invoice', year: 2026, sequence: 1, documentNumber: 'x' },
      { type: 'credit_note', year: 2026, sequence: 1, documentNumber: 'y' },
    ]);
    expect(report).toHaveLength(2);
    expect(report.every((r) => r.missing.length === 0)).toBe(true);
  });

  it('تسلسل سليم لا يعطي أي ملاحظة', () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({
      type: 'invoice', year: 2026, sequence: i + 1, documentNumber: `INV-2026-${i}`,
    }));
    expect(sequenceGaps(docs)[0]).toMatchObject({ count: 20, missing: [], duplicates: [] });
  });
});

describe('إجماليات الفاتورة', () => {
  it('يجمع سطوراً بسعر شامل', () => {
    const t = invoiceTotals([{ description: 'غسلة', quantity: 2, unitPrice: 57.5 }]);
    expect(t.gross).toBe(115);
    expect(t.net).toBe(100);
    expect(t.vat).toBe(15);
  });

  it('المستند يجمع كما يجمعه القارئ — سطراً سطراً', () => {
    // Three awkward lines: a total rounded independently of its lines would
    // print a document that does not add up.
    const lines = [
      { quantity: 1, unitPrice: 33.33 },
      { quantity: 1, unitPrice: 33.33 },
      { quantity: 1, unitPrice: 33.34 },
    ];
    const t = invoiceTotals(lines);
    const sumNet = round2(t.lines.reduce((s, l) => s + l.lineNet, 0));
    const sumVat = round2(t.lines.reduce((s, l) => s + l.lineVat, 0));
    expect(sumNet).toBe(t.net);
    expect(sumVat).toBe(t.vat);
    expect(round2(t.net + t.vat)).toBe(t.gross);
  });

  it('يضرب الكمية في السعر قبل فصل الضريبة', () => {
    const t = invoiceTotals([{ quantity: 3, unitPrice: 115 }]);
    expect(t.gross).toBe(345);
    expect(t.vat).toBe(45);
  });

  it('غير الخاضع لا يحمل ضريبة', () => {
    const t = invoiceTotals([{ quantity: 1, unitPrice: 200 }], { taxable: false });
    expect(t).toMatchObject({ net: 200, vat: 0, gross: 200 });
  });

  it('سعر غير شامل يضيف الضريبة فوقه', () => {
    const t = invoiceTotals([{ quantity: 1, unitPrice: 100 }], { priceMode: 'exclusive' });
    expect(t).toMatchObject({ net: 100, vat: 15, gross: 115 });
  });
});

describe('ترميز TLV لرمز QR', () => {
  it('الوسم والطول ثم القيمة', () => {
    const t = tlv(1, 'AB');
    expect(Array.from(t)).toEqual([1, 2, 0x41, 0x42]);
  });

  it('الطول بالبايت لا بالحرف — العربية حرفان بايتان', () => {
    const t = tlv(1, 'شركة');   // 4 Arabic chars = 8 UTF-8 bytes
    expect(t[1]).toBe(8);
    expect(t.length).toBe(10);
  });

  it('يرفض قيمة أطول من 255 بايت بدل أن يبترها', () => {
    expect(() => tlv(1, 'x'.repeat(256))).toThrow(/255/);
    expect(() => tlv(1, 'x'.repeat(255))).not.toThrow();
  });
});

describe('رمز QR للفاتورة المبسطة', () => {
  const FIELDS = {
    sellerName: 'شركة هادي الغانم',
    vatNumber: '300000000000003',
    timestamp: '2026-08-11T14:30:00Z',
    total: 115,
    vatAmount: 15,
  };

  it('الترميز ثم فك الترميز يعيد الوسوم الخمسة كما هي', () => {
    const decoded = decodeZatcaQrPayload(buildZatcaQrPayload(FIELDS));
    expect(decoded[1]).toBe(FIELDS.sellerName);
    expect(decoded[2]).toBe(FIELDS.vatNumber);
    expect(decoded[3]).toBe(FIELDS.timestamp);
    expect(decoded[4]).toBe('115.00');
    expect(decoded[5]).toBe('15.00');
  });

  it('المبالغ بخانتين عشريتين دائماً', () => {
    const decoded = decodeZatcaQrPayload(buildZatcaQrPayload({ ...FIELDS, total: 8.2, vatAmount: 1.07 }));
    expect(decoded[4]).toBe('8.20');
    expect(decoded[5]).toBe('1.07');
  });

  it('الناتج base64 صالح', () => {
    const payload = buildZatcaQrPayload(FIELDS);
    expect(payload).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('يرفض رقماً ضريبياً غير سعودي', () => {
    expect(validateQrFields({ ...FIELDS, vatNumber: '123456789012345' }))
      .toContain('الرقم الضريبي السعودي يبدأ وينتهي بالرقم 3.');
    expect(validateQrFields({ ...FIELDS, vatNumber: '30000003' }))
      .toContain('الرقم الضريبي يجب أن يكون 15 رقماً.');
  });

  it('يرفض طابعاً زمنياً بلا وقت — التاريخ وحده لا يكفي', () => {
    expect(validateQrFields({ ...FIELDS, timestamp: '2026-08-11' }).length).toBe(1);
    expect(validateQrFields({ ...FIELDS, timestamp: '2026-08-11T00:00:00' })).toEqual([]);
  });

  it('يرفض البناء عند وجود خطأ بدل إصدار رمز مضلّل', () => {
    expect(() => buildZatcaQrPayload({ ...FIELDS, vatNumber: '' })).toThrow(/الرقم الضريبي/);
    expect(() => buildZatcaQrPayload({ ...FIELDS, sellerName: '  ' })).toThrow(/اسم المورّد/);
  });
});

describe('بناء الفاتورة المبسطة', () => {
  const invoice = buildSimplifiedInvoice({
    issueDate: '2026-08-11', issueTime: '14:30:00',
    lines: [{ description: 'غسلة خارجية', quantity: 2, unitPrice: 57.5 }],
    seller: SELLER,
    sourceType: 'wash', sourceId: 'w1',
  });

  it('تبدأ مسودّة بلا رقم — الرقم تمنحه المعاملة', () => {
    expect(invoice.status).toBe('draft');
    expect(invoice.documentNumber).toBeUndefined();
  });

  it('الطابع الزمني يجمع التاريخ والوقت لرمز QR', () => {
    expect(invoice.timestamp).toBe('2026-08-11T14:30:00');
    expect(validateQrFields({
      sellerName: invoice.seller.name, vatNumber: invoice.seller.vatNumber,
      timestamp: invoice.timestamp, total: invoice.gross, vatAmount: invoice.vat,
    })).toEqual([]);
  });

  it('تحتفظ بمصدرها لمنع الازدواج', () => {
    expect(invoice.sourceType).toBe('wash');
    expect(invoice.sourceId).toBe('w1');
  });

  it('الإجماليات محسوبة لا منسوخة', () => {
    expect(invoice).toMatchObject({ net: 100, vat: 15, gross: 115 });
  });
});

describe('الإشعارات الدائنة والمدينة', () => {
  const issued = {
    ...buildSimplifiedInvoice({
      issueDate: '2026-08-11', issueTime: '10:00:00',
      lines: [{ description: 'غسلة', quantity: 4, unitPrice: 57.5 }],
      seller: SELLER,
    }),
    documentNumber: 'INV-2026-000007',
    status: 'issued',
  };

  it('الإشعار الدائن يشير إلى الفاتورة الأصلية', () => {
    const note = buildCreditNote(issued, { issueDate: '2026-08-20', reason: 'إلغاء غسلتين' });
    expect(note.type).toBe('credit_note');
    expect(note.referenceNumber).toBe('INV-2026-000007');
    expect(note.reason).toBe('إلغاء غسلتين');
  });

  it('المبالغ تبقى موجبة — النوع هو ما يحمل الاتجاه', () => {
    const note = buildCreditNote(issued, {
      issueDate: '2026-08-20', reason: 'إرجاع', lines: [{ quantity: 2, unitPrice: 57.5 }],
    });
    expect(note.gross).toBe(115);
    expect(note.vat).toBe(15);
    expect(documentSign('credit_note')).toBe(-1);
    expect(documentSign('debit_note')).toBe(1);
    expect(documentSign('invoice')).toBe(1);
  });

  it('لا إشعار بلا سبب — السبب مطلوب في المراجعة الضريبية', () => {
    expect(() => buildCreditNote(issued, { issueDate: '2026-08-20' })).toThrow(/سبب/);
    expect(() => buildCreditNote(issued, { issueDate: '2026-08-20', reason: '   ' })).toThrow(/سبب/);
    expect(() => buildDebitNote(issued, {
      issueDate: '2026-08-20', lines: [{ quantity: 1, unitPrice: 10 }],
    })).toThrow(/سبب/);
  });

  it('إشعار دائن كامل يلغي أثر الفاتورة تماماً', () => {
    const note = buildCreditNote(issued, { issueDate: '2026-08-20', reason: 'إلغاء كامل' });
    expect(round2(issued.gross * documentSign('invoice') + note.gross * documentSign('credit_note'))).toBe(0);
    expect(round2(issued.vat * documentSign('invoice') + note.vat * documentSign('credit_note'))).toBe(0);
  });

  it('الإشعار المدين يزيد الفاتورة بسطوره هو', () => {
    const note = buildDebitNote(issued, {
      issueDate: '2026-08-21', reason: 'فرق سعر', lines: [{ quantity: 1, unitPrice: 23 }],
    });
    expect(note.type).toBe('debit_note');
    expect(note.gross).toBe(23);
    expect(note.vat).toBe(3);
  });

  it('يرث هوية المورّد ووضع التسعير من الفاتورة', () => {
    const note = buildCreditNote(issued, { issueDate: '2026-08-20', reason: 'خطأ' });
    expect(note.seller).toEqual(issued.seller);
    expect(note.priceMode).toBe(issued.priceMode);
    expect(note.taxable).toBe(issued.taxable);
  });
});

describe('حدود التكامل معلنة لا مُدّعاة', () => {
  it('ما هو منفّذ فعلاً منفّذ', () => {
    expect(INTEGRATION_STATUS.phase1QrPayload).toBe('implemented');
    expect(INTEGRATION_STATUS.invoiceNumbering).toBe('implemented');
    expect(INTEGRATION_STATUS.creditDebitNotes).toBe('implemented');
  });

  it('وما ليس منفّذاً معلن بوضوح — لا ادّعاء بربط مع فاتورة', () => {
    for (const key of ['cryptographicStamp', 'invoiceHashChain', 'clearanceApi', 'reportingApi', 'onboarding']) {
      expect(INTEGRATION_STATUS[key]).toBe('not_implemented');
    }
  });
});
