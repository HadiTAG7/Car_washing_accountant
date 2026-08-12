import { describe, it, expect } from 'vitest';
import { transitionedToApproved, describeAutoPost, autoPostTone, editWarningFor } from '../autoPost';
import { ADAPTERS } from '../sourceAdapters';

describe('لحظة الاعتماد', () => {
  it('الغسلة تُعتمد عند اكتمالها فقط', () => {
    expect(transitionedToApproved('wash', { status: 'قيد التنفيذ' }, { status: 'مكتملة' })).toBe(true);
    expect(transitionedToApproved('wash', { status: 'قيد التنفيذ' }, { status: 'قيد التنفيذ' })).toBe(false);
    expect(transitionedToApproved('wash', { status: 'مكتملة' }, { status: 'قيد التنفيذ' })).toBe(false);
  });

  it('إعادة حفظ غسلة مكتملة ليست انتقالاً — ولا تُنتج قيداً ثانياً', () => {
    expect(transitionedToApproved('wash', { status: 'مكتملة' }, { status: 'مكتملة' })).toBe(false);
  });

  it('سجل جديد يولد معتمداً يُعدّ انتقالاً', () => {
    expect(transitionedToApproved('wash', null, { status: 'مكتملة' })).toBe(true);
    expect(transitionedToApproved('wash', null, { status: 'قيد التنفيذ' })).toBe(false);
  });

  it('المصروف الشهري يُعتمد عندما يحمل تاريخاً', () => {
    expect(transitionedToApproved('monthly', { logged_date: null }, { logged_date: '2026-08-05' })).toBe(true);
    expect(transitionedToApproved('monthly', { logged_date: null }, { logged_date: null })).toBe(false);
  });

  it('نوع غير معروف لا ينفجر — يعيد false', () => {
    expect(transitionedToApproved('nope', {}, {})).toBe(false);
  });
});

describe('صياغة النتيجة للمستخدم', () => {
  it('النجاح يذكر رقم القيد', () => {
    expect(describeAutoPost({ status: 'posted', entryNumber: 12 })).toMatch(/قيد رقم 12/);
    expect(autoPostTone({ status: 'posted' })).toBe('success');
  });

  it('الإخفاق يُعرض كخطأ مع طريق للعلاج — ولا يُبتلع', () => {
    const msg = describeAutoPost({ status: 'failed', error: 'القيد غير متوازن' });
    expect(msg).toMatch(/تعذّر الترحيل التلقائي/);
    expect(msg).toMatch(/القيد غير متوازن/);
    expect(msg).toMatch(/إقفال الفترة/);
    expect(autoPostTone({ status: 'failed' })).toBe('error');
  });

  it('التخطّي العادي هادئ، والحاجب يُعرض كخطأ', () => {
    expect(autoPostTone({ status: 'skipped', reason: 'مُرحّل مسبقاً.', blocking: false })).toBe('info');
    expect(autoPostTone({ status: 'skipped', reason: 'الفترة مقفلة', blocking: true })).toBe('error');
  });
});

describe('التحذير عند تعديل سجل مُرحّل', () => {
  const entries = [{ sourceType: 'wash', sourceId: 'w1', status: 'posted' }];

  it('يحذّر لأن القيد المُرحّل لا يتبع التعديل', () => {
    const w = editWarningFor('wash', { id: 'w1' }, entries);
    expect(w).toMatch(/مُرحّل إلى الدفاتر/);
    expect(w).toMatch(/قيد عكسي|قيد تسوية/);
  });

  it('ولا يحذّر لسجل غير مُرحّل أو قيد معكوس', () => {
    expect(editWarningFor('wash', { id: 'w2' }, entries)).toBeNull();
    expect(editWarningFor('wash', { id: 'w1' },
      [{ sourceType: 'wash', sourceId: 'w1', status: 'reversed' }])).toBeNull();
  });
});

describe('المحوّلات مشتركة بين المسارين', () => {
  it('كل محوّل يعرّف الحقول التي يعتمد عليها المساران', () => {
    for (const [key, a] of Object.entries(ADAPTERS)) {
      expect(a.collection, key).toBeTruthy();
      expect(a.sourceType, key).toBeTruthy();
      expect(typeof a.sourceId, key).toBe('function');
      expect(typeof a.dateOf, key).toBe('function');
      expect(typeof a.isApproved, key).toBe('function');
      expect(typeof a.build, key).toBe('function');
      expect(typeof a.label, key).toBe('function');
    }
  });

  it('كل محوّل قابل للرفض يشرح سبب الرفض', () => {
    for (const [key, a] of Object.entries(ADAPTERS)) {
      // If a source can be un-approved, it must say why in Arabic.
      const canReject = a.isApproved.length > 0;
      if (canReject) expect(a.notApprovedReason, key).toBeTruthy();
    }
  });

  it('المصاريف كلها تُعرَف بنفس نوع المصدر — أساس منع الازدواج', () => {
    for (const k of ['monthly', 'variable', 'annual', 'startup', 'voucher']) {
      expect(ADAPTERS[k].sourceType).toBe('expense');
    }
    expect(ADAPTERS.wash.sourceType).toBe('wash');
    expect(ADAPTERS.recovery.sourceType).toBe('recovery');
  });

  it('محوّل الغسلة يبني قيداً متوازناً من صف خام', () => {
    const built = ADAPTERS.wash.build({
      id: 'w1', biker_name: 'أحمد', quantity: 2, price: 57.5,
      status: 'مكتملة', wash_date: '2026-08-11', payment_method: 'cash',
    });
    expect(built.entry.sourceType).toBe('wash');
    expect(built.entry.sourceId).toBe('w1');
    const debit = built.lines.reduce((s, l) => s + l.debit, 0);
    const credit = built.lines.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(115);
    expect(credit).toBe(115);
  });
});
