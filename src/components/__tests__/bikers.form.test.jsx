// @vitest-environment jsdom
/**
 * نماذج البايكر — ما يمنع الحفظ، وما يصل إلى onPay بالضبط
 * ═══════════════════════════════════════════════════════════════════════════
 * The salary dialog is the one place money leaves through TWO records at
 * once, so the contract under test is its PAYLOAD: which advances were
 * checked, which recovery account travels with the payment method, and that
 * an over-deduction blocks submission rather than paying a negative wage.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import AddBikerModal from '../AddBikerModal';
import PaySalaryModal from '../PaySalaryModal';
import AddBikerAdvanceModal from '../AddBikerAdvanceModal';

// AddWashModal (imported transitively nowhere here) — but AddBikerModal pulls
// only UI deps. useBikers reaches firebaseClient through the page, not these
// modals, so no mocking is needed.

afterEach(cleanup);

const $ = (sel) => document.querySelector(sel);
const set = (sel, value) => fireEvent.change($(sel), { target: { value } });
const chooseDay = (field, day) => {
  fireEvent.click($(field));
  const calendar = screen.getByRole('dialog', { name: 'التقويم' });
  fireEvent.click([...calendar.querySelectorAll('button')].find((button) => button.textContent === String(day)));
};

function submit() {
  const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
  // The click is what a user does; the direct submit is the belt — a
  // handleSubmit that ignored `isValid` could hide behind a disabled button.
  fireEvent.click(btn);
  fireEvent.submit(btn.closest('form'));
  return btn;
}

const BIKER = { id: 'b1', name: 'أحمد', salary: 2000 };

describe('AddBikerModal', () => {
  it('بلا اسم لا حفظ — الاسم هو مفتاح الربط بالغسلات', () => {
    const onAdd = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd} />);
    set('#bikerFormSalary', '2000');
    submit();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('الاسم وحده يكفي، والراتب الفارغ يُحفظ صفراً لا NaN', () => {
    const onAdd = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd} />);
    set('#bikerFormName', '  أحمد  ');
    submit();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'أحمد', salary: 0 });
  });

  it('وفي التعديل تصل القيم الحالية وتُحفظ عبر onUpdate', () => {
    const onUpdate = vi.fn();
    render(
      <AddBikerModal
        isOpen
        onClose={() => {}}
        onUpdate={onUpdate}
        initialValues={{ id: 'b1', name: 'أحمد', salary: 2000, contactNumber: '0500000000' }}
      />,
    );
    expect($('#bikerFormName').value).toBe('أحمد');
    set('#bikerFormSalary', '2500');
    submit();
    expect(onUpdate).toHaveBeenCalledWith('b1', expect.objectContaining({ salary: 2500 }));
  });

  it('نهاية الخدمة لا تسبق المباشرة وكلا اليومين يصلان للحفظ', () => {
    const onAdd = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd} />);
    set('#bikerFormName', 'أحمد');
    chooseDay('#bikerFormStartDate', 10);
    chooseDay('#bikerFormEndDate', 9);
    submit();
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('لا يسبق');

    chooseDay('#bikerFormEndDate', 10);
    submit();
    // الشهر يُشتقّ من اليوم لا يُثبَّت: التقويم يفتح على الشهر الجاري، فتاريخٌ
    // مكتوبٌ بيده يمرّ في الشهر الذي كُتب فيه ويسقط في الذي يليه. والمُختبَر
    // هنا «لا تسبق النهايةُ البدايةَ وكلاهما يصل» — لا أيُّ شهرٍ نحن فيه.
    const ym = new Date().toISOString().slice(0, 7);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      startDate: `${ym}-10`, endDate: `${ym}-10`,
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// اسم الكفيل — نصٌّ حرّ يقترح ولا يحبس
// ═══════════════════════════════════════════════════════════════════════════
// A closed picker would block the first biker of a new sponsor; free text with
// no memory would grow «مؤسسة النور» and «مؤسسه النور» side by side. The claim
// under test is the middle: the payload is whatever was typed, and the
// SUGGESTIONS are de-duplicated by Arabic normalization while still being
// shown in the spelling a human actually wrote.
const SPONSORED = [
  { id: 'b1', name: 'أحمد', sponsor: 'مؤسسة النور' },
  { id: 'b2', name: 'سالم', sponsor: 'مؤسسه النور' },   // نفس الكفيل بإملاء آخر
  { id: 'b3', name: 'خالد', sponsor: 'شركة الفجر' },
  { id: 'b4', name: 'ماجد', sponsor: '   ' },            // فراغ لا يصير اقتراحاً
  { id: 'b5', name: 'فهد' },                             // بلا كفيل أصلاً
];

const options = () => [...document.querySelectorAll('#bikerSponsorOptions option')]
  .map((o) => o.value);

describe('AddBikerModal — اسم الكفيل', () => {
  it('الكفيل يصل مُشذَّباً إلى onAdd', () => {
    const onAdd = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd} />);
    set('#bikerFormName', 'أحمد');
    set('#bikerFormSponsor', '  مؤسسة النور للخدمات  ');
    submit();
    expect(onAdd.mock.calls[0][0].sponsor).toBe('مؤسسة النور للخدمات');
  });

  it('والفراغ يصل \'\' لا undefined — «بلا كفيل» حقيقةٌ تُكتب، لا حقلٌ غائب', () => {
    // المحوِّل يقلب '' إلى null؛ وundefined يجعل toBikerUpdate يتخطّى الحقل
    // كلياً، فلا يُمحى كفيلٌ أُزيل عمداً.
    const onAdd = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd} />);
    set('#bikerFormName', 'أحمد');
    submit();
    expect(onAdd.mock.calls[0][0].sponsor).toBe('');
  });

  it('والتحرير يُعبّئ الكفيل القائم ويعيده كما هو إن لم يُلمَس', () => {
    const onUpdate = vi.fn();
    render(
      <AddBikerModal
        isOpen
        onClose={() => {}}
        onUpdate={onUpdate}
        initialValues={{ id: 'b1', name: 'أحمد', salary: 2000, sponsor: 'مؤسسة النور' }}
      />,
    );
    expect($('#bikerFormSponsor').value).toBe('مؤسسة النور');
    submit();
    expect(onUpdate).toHaveBeenCalledWith('b1', expect.objectContaining({ sponsor: 'مؤسسة النور' }));
  });

  it('والاقتراحات تجمع الإملاءين في واحد — وتعرضه كما كُتب لا مُطبَّعاً', () => {
    // الادعاء الحامل: التطبيع للمقارنة لا للعرض. لو عُرض ناتجه لظهر
    // «مؤسسه النور» — اسمٌ لم يكتبه أحد.
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={vi.fn()} bikers={SPONSORED} />);
    expect(options()).toEqual(['شركة الفجر', 'مؤسسة النور']);
  });

  it('وبلا كفلاء سابقين: لا اقتراحات ولا سطر شرح — والحقل يبقى صالحاً', () => {
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={vi.fn()} />);
    expect(options()).toEqual([]);
    expect(document.body.textContent).not.toContain('يقترح الكفلاء');
    expect($('#bikerFormSponsor')).toBeTruthy();
  });

  it('وكفيلٌ جديد لا يمنعه المنتقي — الاقتراح ليس حصراً', () => {
    const onAdd = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd} bikers={SPONSORED} />);
    set('#bikerFormName', 'ناصر');
    set('#bikerFormSponsor', 'مكتب لم يُسجَّل من قبل');
    submit();
    expect(onAdd.mock.calls[0][0].sponsor).toBe('مكتب لم يُسجَّل من قبل');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// الجنسية — نفس عقد الكفيل، ودالة اقتراحٍ واحدة تخدم الحقلين
// ═══════════════════════════════════════════════════════════════════════════
// التعميم أدخل خطراً جديداً لم يكن في النسختين المنفصلتين: أن تتقاطع
// القائمتان — فيقترح حقلُ الجنسية كفيلاً. فالاختبار الحامل هنا هو الفصل،
// لا التشذيب.
const MIXED = [
  { id: 'b1', name: 'أحمد', sponsor: 'مؤسسة النور', nationality: 'أفغاني' },
  { id: 'b2', name: 'سالم', sponsor: 'شركة الفجر',  nationality: 'افغاني' },   // همزة مختلفة
  { id: 'b3', name: 'خالد', nationality: 'باكستاني' },
];

const optionsOf = (id) => [...document.querySelectorAll(`#${id} option`)].map((o) => o.value);

describe('AddBikerModal — الجنسية', () => {
  it('الجنسية تصل مُشذَّبة إلى onAdd، والفراغ يصل \'\'', () => {
    const onAdd = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd} />);
    set('#bikerFormName', 'أحمد');
    set('#bikerFormNationality', '  باكستاني  ');
    submit();
    expect(onAdd.mock.calls[0][0].nationality).toBe('باكستاني');

    cleanup();
    const onAdd2 = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd2} />);
    set('#bikerFormName', 'سالم');
    submit();
    expect(onAdd2.mock.calls[0][0].nationality).toBe('');
  });

  it('والتحرير يُعبّئ الجنسية ويعيدها كما هي إن لم تُلمَس', () => {
    const onUpdate = vi.fn();
    render(
      <AddBikerModal
        isOpen
        onClose={() => {}}
        onUpdate={onUpdate}
        initialValues={{ id: 'b1', name: 'أحمد', salary: 2000, nationality: 'باكستاني' }}
      />,
    );
    expect($('#bikerFormNationality').value).toBe('باكستاني');
    submit();
    expect(onUpdate).toHaveBeenCalledWith('b1', expect.objectContaining({ nationality: 'باكستاني' }));
  });

  it('والاقتراحات تجمع الهمزتين في واحدة — وتعرضها كما كُتبت أولاً', () => {
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={vi.fn()} bikers={MIXED} />);
    expect(optionsOf('bikerNationalityOptions')).toEqual(['أفغاني', 'باكستاني']);
  });

  it('والقائمتان لا تتقاطعان — لا كفيل في اقتراحات الجنسية ولا العكس', () => {
    // الادعاء الحامل للتعميم: دالةٌ واحدة تخدم الحقلين يجب ألّا تخلطهما.
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={vi.fn()} bikers={MIXED} />);
    const nat = optionsOf('bikerNationalityOptions');
    const spo = optionsOf('bikerSponsorOptions');
    expect(nat).not.toContain('مؤسسة النور');
    expect(spo).not.toContain('أفغاني');
    expect(spo).toEqual(['شركة الفجر', 'مؤسسة النور']);
  });
});

describe('AddBikerAdvanceModal', () => {
  it('يرسل السلفة باسم البايكر ومعرّفه وطريقة الصرف', () => {
    const onAdd = vi.fn();
    render(<AddBikerAdvanceModal isOpen onClose={() => {}} biker={BIKER} onAdd={onAdd} />);
    set('#advanceAmount', '300');
    set('#advanceMethod', 'bank');
    submit();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      title: 'سلفة — أحمد',
      amount: 300,
      status: 'pending',
      bikerId: 'b1',
      paymentMethod: 'bank',
    });
  });

  it('صفر أو فراغ لا يُرسل', () => {
    const onAdd = vi.fn();
    render(<AddBikerAdvanceModal isOpen onClose={() => {}} biker={BIKER} onAdd={onAdd} />);
    set('#advanceAmount', '0');
    submit();
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('PaySalaryModal', () => {
  const ADVANCES = [
    { id: 't1', title: 'سلفة — أحمد', amount: 300, spentDate: '2026-08-01' },
    { id: 't2', title: 'سلفة — أحمد', amount: 200, spentDate: '2026-08-05' },
  ];

  it('السلف كلها محدَّدة افتراضاً، والمعاينة = راتب − المخصوم', () => {
    render(
      <PaySalaryModal isOpen onClose={() => {}} biker={BIKER} pendingAdvances={ADVANCES} onPay={vi.fn()} />,
    );
    // الراتب مُعبّأ من الملف، والصافي 2000 − 500 = 1500 ظاهر في زر الإرسال.
    expect($('#salaryAmount').value).toBe('2000');
    const submitBtn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
    expect(submitBtn.textContent).toContain('1,500');
  });

  it('onPay يستلم السلف المحدَّدة وحساب الاسترداد المطابق لطريقة الدفع', () => {
    const onPay = vi.fn();
    render(
      <PaySalaryModal isOpen onClose={() => {}} biker={BIKER} pendingAdvances={ADVANCES} onPay={onPay} />,
    );
    // أزل الثانية — يبقى الخصم 300 فقط.
    const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')];
    fireEvent.click(checkboxes[1]);
    set('#salaryMethod', 'transfer');
    submit();

    expect(onPay).toHaveBeenCalledTimes(1);
    const payload = onPay.mock.calls[0][0];
    expect(payload.amount).toBe(2000);
    expect(payload.deductedAdvances.map((a) => a.id)).toEqual(['t1']);
    // تحويل بنكي ⇒ الاسترداد يعود إلى البنك، لا إلى الصندوق.
    expect(payload.paymentMethod).toBe('transfer');
    expect(payload.recoveryMethod).toBe('bank');
  });

  it('خصمٌ أكبر من الراتب يوقف الإرسال ويقول السبب', () => {
    const onPay = vi.fn();
    render(
      <PaySalaryModal
        isOpen
        onClose={() => {}}
        biker={{ ...BIKER, salary: 400 }}
        pendingAdvances={ADVANCES}
        onPay={onPay}
      />,
    );
    // الراتب 400 والسلف المحددة 500 — الرسالة ظاهرة والإرسال لا يمرّ.
    expect(screen.getByRole('alert').textContent).toContain('أكبر من الراتب');
    submit();
    expect(onPay).not.toHaveBeenCalled();
  });

  it('تحذير التكرار يظهر عند وجود راتب مسجَّل لنفس الشهر', () => {
    const month = new Date().toISOString().slice(0, 7);
    render(
      <PaySalaryModal
        isOpen
        onClose={() => {}}
        biker={BIKER}
        pendingAdvances={[]}
        salaryPaidInMonth={month}
        onPay={vi.fn()}
      />,
    );
    expect(document.body.textContent).toContain('سبق تسجيل راتب');
  });
});
