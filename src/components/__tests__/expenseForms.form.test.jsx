// @vitest-environment jsdom
/**
 * حفظ المصروف يتوقف عند خطأ الضريبة — proved by submitting the real forms
 * ═══════════════════════════════════════════════════════════════════════════
 * `TaxInvoiceFields` used to compute a `vatProblem`, paint it red, and let the
 * form save anyway: the message reached the user's eye and nothing else. On
 * the way out, `statedVatAmount` turned the offending value into `null` — the
 * SAME thing it stores for "the supplier did not state one" — so the record
 * was written as though the field had been left empty and the typo left no
 * trace at all. A negative VAT was not rejected; it was erased.
 *
 * So the claim under test is about the FORM, not about a helper the form
 * happens to call: submit it and prove `onAdd` / `onUpdate` were never
 * reached. Every expense source is driven, because they share the field group
 * and would therefore share the hole.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AddMonthlyExpenseModal from '../AddMonthlyExpenseModal';
import AddVariableExpenseModal from '../AddVariableExpenseModal';
import ExpenseLedgerModal from '../ExpenseLedgerModal';

afterEach(cleanup);

const CATEGORIES = [{ id: 'c1', label: 'تشغيل' }];

const $ = (sel) => document.querySelector(sel);
const set = (sel, value) => fireEvent.change(typeof sel === 'string' ? $(sel) : sel, { target: { value } });
const vatAmountInput = (p) => $(`#${p}-vat-amount`);
const vatRateInput = (p) => $(`#${p}-vat-rate`);

function submitForm() {
  const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
  // The click is what a user does; the direct form submit is the belt — a
  // `handleSubmit` that ignored `isValid` could otherwise hide behind a
  // disabled button and never be caught.
  fireEvent.click(btn);
  fireEvent.submit(btn.closest('form'));
  return btn;
}

// ═══════════════════════════════════════════════════════════════════════════
// الحالات، مشتركةً بين المصادر
// ═══════════════════════════════════════════════════════════════════════════
// `amount` on every fixture is 115 — 100 plus 15% — so «الضريبة أكبر من
// الإجمالي» is a real overflow rather than an artefact of an odd fixture.
// Typed into the real `<input type="number">`. A non-numeric string is not
// among them because the control itself refuses one — it reports an empty
// value, so the form legitimately sees "not stated". A NaN or an Infinity
// reaches the app another way, and is covered on the edit path below.
const BAD_VALUES = [
  ['قيمة سالبة', '-5'],
  ['أكبر من إجمالي الفاتورة الشامل', '200'],
];
const GOOD_VALUES = [
  ['صفر صريح — توريد صفري أو معفى', '0'],
  ['فارغ — غير مذكور، يسقط إلى النسبة ثم السياسة', ''],
  ['مبلغ يوافق النسبة', '15'],
];

/**
 * Each source, mounted and filled so that everything EXCEPT the tax field is
 * already valid — the tax field is then the only thing that can block a save.
 *
 * `initial` builds the `initialValues` for the edit-path cases; the ledger
 * modal has no edit path (its rows are added and deleted, never edited), so
 * it declares none and those cases skip it.
 */
const SOURCES = [
  {
    name: 'المصاريف الشهرية',
    prefix: 'monthly',
    mount: (handlers, initialValues = null) => render(
      <AddMonthlyExpenseModal
        isOpen onClose={() => {}} categories={CATEGORIES} initialValues={initialValues}
        onAddCategory={() => {}} onDeleteCategory={() => {}} {...handlers} />,
    ),
    fill: () => {
      set('#expenseName', 'إيجار');
      set('#unitCost', '115');
      // A recurring TEMPLATE has no date and no invoice; the one-off row does.
      fireEvent.click([...document.querySelectorAll('button')]
        .find((b) => /مرة واحدة/.test(b.textContent)));
      fireEvent.click($('#monthlyIsTaxInvoice'));
    },
    initial: (over) => ({
      id: 'm1', expenseName: 'إيجار', categoryId: 'c1', quantity: 1, unitCost: 115,
      recurrence: 'one_time', loggedDate: '2026-03-15', paymentStatus: 'paid',
      isTaxInvoice: true, invoiceNumber: 'INV-1', invoiceDate: '2026-03-15',
      supplier: 'مورّد', vatAmount: 15, vatRate: null, priceMode: 'inclusive',
      vatDeductible: true, ...over,
    }),
  },
  {
    name: 'المصاريف المتغيرة',
    prefix: 'variable',
    mount: (handlers, initialValues = null) => render(
      <AddVariableExpenseModal
        isOpen onClose={() => {}} categories={CATEGORIES} initialValues={initialValues}
        onAddCategory={() => {}} onDeleteCategory={() => {}} {...handlers} />,
    ),
    fill: () => {
      set('#expenseName', 'مواد');
      set('#unitCost', '115');
      fireEvent.click($('#variableIsTaxInvoice'));
    },
    initial: (over) => ({
      id: 'v1', expenseName: 'مواد', categoryId: 'c1', quantity: 1, unitCost: 115,
      loggedDate: '2026-03-15', isTaxInvoice: true, invoiceNumber: 'INV-1',
      invoiceDate: '2026-03-15', supplier: 'مورّد', vatAmount: 15,
      vatRate: null, priceMode: 'inclusive', vatDeductible: true, ...over,
    }),
  },
  {
    // ONE component, TWO sub-ledgers: رسوم التأسيس and المصاريف السنوية each
    // hand it their own `addEntry`. Driving it once covers both, and a change
    // that broke one would break the other.
    name: 'سجل رسوم التأسيس / المصاريف السنوية',
    prefix: 'ledger',
    mount: (handlers) => render(
      <ExpenseLedgerModal
        isOpen onClose={() => {}} title="سجل" plannedAmount={1000}
        ledger={{
          entries: [], loading: false, error: null,
          addEntry: handlers.onAdd, deleteEntry: () => {},
        }} />,
    ),
    fill: () => {
      set('input[name="description"]', 'معدات');
      set('input[name="amount"]', '115');
      // `spentDate` is seeded to today when the modal opens, and its control
      // is the branded calendar rather than a typeable input — so it is left
      // as the form set it.
      fireEvent.click($('#ledgerIsTaxInvoice'));
    },
    initial: null,
  },
];

describe.each(SOURCES)('$name', ({ prefix, mount, fill }) => {
  describe('خطأ الضريبة يمنع الحفظ', () => {
    it.each(BAD_VALUES)('%s: لا يُستدعى onAdd ولا onUpdate', (_label, value) => {
      const onAdd = vi.fn();
      const onUpdate = vi.fn();
      mount({ onAdd, onUpdate });
      fill();
      set(vatAmountInput(prefix), value);

      const btn = submitForm();
      expect(onAdd).not.toHaveBeenCalled();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(btn.disabled).toBe(true);
      // …ويُقال للمستخدم لماذا، بدل أن تُمحى قيمته بصمت.
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });

  });

  describe('والقيم الصالحة تمرّ', () => {
    it.each(GOOD_VALUES)('%s: يُستدعى onAdd', (_label, value) => {
      const onAdd = vi.fn();
      mount({ onAdd });
      fill();
      set(vatAmountInput(prefix), value);
      submitForm();
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('والمبلغ غير المذكور يصل null لا صفراً', () => {
      const onAdd = vi.fn();
      mount({ onAdd });
      fill();
      submitForm();
      expect(onAdd.mock.calls[0][0].vatAmount).toBeNull();
      expect(onAdd.mock.calls[0][0].vatRate).toBeNull();
    });

    it('والصفر الصريح يصل صفراً لا null', () => {
      const onAdd = vi.fn();
      mount({ onAdd });
      fill();
      set(vatAmountInput(prefix), '0');
      submitForm();
      expect(onAdd.mock.calls[0][0].vatAmount).toBe(0);
    });

    it('ونسبة 5% تصل 5% — لا 15%', () => {
      const onAdd = vi.fn();
      mount({ onAdd });
      fill();
      set(vatRateInput(prefix), '0.05');
      submitForm();
      expect(onAdd.mock.calls[0][0]).toMatchObject({ vatRate: 0.05, priceMode: 'inclusive' });
    });

    it('ووضع «غير شامل» يصل كما اختير', () => {
      const onAdd = vi.fn();
      mount({ onAdd });
      fill();
      set(`#${prefix}-price-mode`, 'exclusive');
      submitForm();
      expect(onAdd.mock.calls[0][0].priceMode).toBe('exclusive');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// التعديل — وسجل وصل بقيمة فاسدة
// ═══════════════════════════════════════════════════════════════════════════
// The date field is a custom calendar that refuses an impossible date, so
// 2026-02-30 cannot be TYPED. It can still arrive: an import, a direct
// Firestore write, a client from before the check existed. Opening such a
// record must not let it be saved forward as though it were fine.
const EDITABLE = SOURCES.filter((s) => s.initial);

describe.each(EDITABLE)('$name — تعديل سجل قائم', ({ prefix, mount, initial }) => {
  it('تاريخ فاتورة غير موجود في التقويم (2026-02-30) يمنع الحفظ', () => {
    const onUpdate = vi.fn();
    const onAdd = vi.fn();
    mount({ onAdd, onUpdate }, initial({ invoiceDate: '2026-02-30' }));
    submitForm();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('وتاريخ حقيقي في الشهر نفسه يمرّ — 2026-02-28', () => {
    const onUpdate = vi.fn();
    mount({ onAdd: () => {}, onUpdate }, initial({ invoiceDate: '2026-02-28' }));
    submitForm();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  // ── قيمة فاسدة مخزَّنة تبقى ظاهرة ولا تُمحى ──
  // The form's `initialValues` come straight from Firestore. A value that was
  // written before the checks existed — or by a direct write — must not read
  // back as an empty field: blank looks correct, saving would store `null`,
  // and the mistake would be erased rather than fixed while the server went
  // on refusing to post the record.
  it.each([
    ['نسبة خارج المدى', { vatRate: 1.5, vatAmount: null }],
    ['نسبة سالبة', { vatRate: -0.1, vatAmount: null }],
    ['مبلغ سالب', { vatAmount: -5 }],
    ['مبلغ NaN', { vatAmount: NaN }],
    ['مبلغ Infinity', { vatAmount: Infinity }],
    ['مبلغ يتجاوز الإجمالي الشامل', { vatAmount: 500 }],
  ])('%s مخزَّنة تمنع الحفظ', (_label, over) => {
    const onUpdate = vi.fn();
    mount({ onAdd: () => {}, onUpdate }, initial(over));
    submitForm();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('وقيمة ضريبة سالبة تمنع onUpdate ولا تُحوَّل إلى null', () => {
    const onUpdate = vi.fn();
    const onAdd = vi.fn();
    mount({ onAdd, onUpdate }, initial({}));
    set(vatAmountInput(prefix), '-5');
    submitForm();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('وتصحيحها يعيد فتح الحفظ بالقيمة المصحَّحة', () => {
    const onUpdate = vi.fn();
    mount({ onAdd: () => {}, onUpdate }, initial({}));
    set(vatAmountInput(prefix), '-5');
    submitForm();
    expect(onUpdate).not.toHaveBeenCalled();

    set(vatAmountInput(prefix), '15');
    submitForm();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][1]).toMatchObject({ vatAmount: 15 });
  });
});
