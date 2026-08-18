// @vitest-environment jsdom
/**
 * تقسيمات البند السنوي — الحقل يُقرأ، والرفض يُقال
 * ═══════════════════════════════════════════════════════════════════════════
 * لماذا هذا الملف موجود: نفس الخانة على بند التأسيس **شُحنت ولم تُقرأ**.
 * كان `handleSubmit` يبني حمولته من أربعة حقول و`unitsText` لا يُلمَس، فخمسة
 * أسماء سكنات تُمحى في المتصفّح قبل أي نداء شبكة — بلا خطأ، وبلا حفظ، وبشاشةٍ
 * تبدو كأنها نجحت. فالادعاء الحامل هنا واحد: **`units` تصل `onAdd` فعلاً**.
 *
 * والثاني: بند الإيجار مسجَّل منذ زمن، فمسار **التحرير** هو المسار الحقيقي —
 * لا الإضافة. تقسيماته يجب أن تُعبَّأ وتعود.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AddAnnualExpenseModal from '../AddAnnualExpenseModal';

afterEach(cleanup);

const CATEGORIES = [{ id: 'c1', label: 'إيجار ومرافق' }];

const $ = (sel) => document.querySelector(sel);
const set = (sel, value) => fireEvent.change($(sel), { target: { value } });

function submit() {
  const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
  fireEvent.click(btn);
  fireEvent.submit(btn.closest('form'));
  return btn;
}

const open = (props = {}) => render(
  <AddAnnualExpenseModal isOpen onClose={() => {}} categories={CATEGORIES} {...props} />,
);

/** الحد الأدنى الذي يجعل النموذج صالحاً — الاسم والتكلفة. */
function fillRequired() {
  set('#expenseName', 'إيجار السكن');
  set('#unitCost', '40000');
}

describe('AddAnnualExpenseModal — التقسيمات', () => {
  it('الخانة موجودة واختيارية — بندٌ بلا تقسيمات يُحفظ ومعه مصفوفة فارغة', () => {
    const onAdd = vi.fn();
    open({ onAdd });
    expect($('#unitsText')).toBeTruthy();
    fillRequired();
    submit();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].units).toEqual([]);
  });

  it('والأسطر تصل قائمةً مُشذَّبة — الادعاء الذي سقط مرةً على بند التأسيس', () => {
    const onAdd = vi.fn();
    open({ onAdd });
    fillRequired();
    set('#unitsText', '  سكن الشمال  \n\n سكن الغرب \n   \n');
    submit();
    expect(onAdd.mock.calls[0][0].units).toEqual(['سكن الشمال', 'سكن الغرب']);
  });

  it('والتحرير يُعبّئ التقسيمات القائمة ويعيدها — مسار الإيجار الحقيقي', () => {
    const onUpdate = vi.fn();
    open({
      onUpdate,
      initialValues: {
        id: 'a1', expenseName: 'إيجار السكن', category: 'c1', quantity: 1,
        annualCost: 40000, paymentMonth: 1, paymentDay: 1, paymentStatus: 'pending',
        units: ['سكن الشمال', 'سكن الغرب'],
      },
    });
    expect($('#unitsText').value).toBe('سكن الشمال\nسكن الغرب');
    submit();
    expect(onUpdate).toHaveBeenCalledWith('a1', expect.objectContaining({
      units: ['سكن الشمال', 'سكن الغرب'],
    }));
  });

  it('وقائمةٌ أُفرغت تصل فارغة — لا «اتركها كما هي»', () => {
    // `units` غائبةً تعني «لا تمسّها» في toAnnualExpenseUpdate، فلولا الإرسال
    // الدائم لتعذّر محو تقسيمٍ أُضيف بالخطأ.
    const onUpdate = vi.fn();
    open({
      onUpdate,
      initialValues: {
        id: 'a1', expenseName: 'إيجار', category: 'c1', quantity: 1,
        annualCost: 40000, paymentMonth: 1, paymentDay: 1, paymentStatus: 'pending',
        units: ['سكن الشمال'],
      },
    });
    set('#unitsText', '');
    submit();
    expect(onUpdate.mock.calls[0][1].units).toEqual([]);
  });

  it('واسمٌ مكرّر يُرفض بصوتٍ مسموع ولا يُحفظ شيء', () => {
    const onAdd = vi.fn();
    open({ onAdd });
    fillRequired();
    set('#unitsText', 'سكن الشمال\nسكن  الشمال ');   // نفس السكن بإملاءٍ ثانٍ
    submit();
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('ورفضُ الخادم يُعرَض والمودال يبقى مفتوحاً بقيمه', async () => {
    const onClose = vi.fn();
    const onAdd = vi.fn().mockRejectedValue(new Error('تم رفض الطلب بواسطة قواعد الأمان'));
    open({ onAdd, onClose });
    fillRequired();
    set('#unitsText', 'سكن الشمال');
    submit();

    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('قواعد الأمان');
    expect(onClose).not.toHaveBeenCalled();
    expect($('#unitsText').value).toBe('سكن الشمال');
  });
});
