// @vitest-environment jsdom
/**
 * تقسيمات البند تصل إلى الحفظ — الاختبار الذي لم يكن موجوداً
 * ═══════════════════════════════════════════════════════════════════════════
 * `AddStartupFeeModal` شُحن بلا أي اختبار، وفيه مربّعُ «تقسيمات البند» يُعرَض
 * ويُعبَّأ عند التعديل — و`handleSubmit` يبني حمولته من أربعة حقول لا خامس
 * لها. فالمستخدم كتب أسماء السكنات الخمسة، وضغط حفظ، **ورُميت في المتصفّح
 * قبل أي طلب شبكة**: لا خطأ، ولا حفظ، وشاشةٌ تبدو كأنها نجحت.
 *
 * فالادعاء المُختبَر هنا هو الحمولة نفسها — ما الذي يصل `onUpdate`/`onAdd`
 * بالضبط — لأن كل ما بعده (الخطّاف، المُحوِّل، الخادم) كان سليماً وينتظر
 * حقلاً لا يصل.
 *
 * والادعاء الثاني: الرفض يُقال. النموذج كان `try`/`finally` بلا `catch`،
 * فيُغلق كأن الحفظ تمّ مهما رفض الخادم.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AddStartupFeeModal from '../AddStartupFeeModal';

afterEach(cleanup);

const CATEGORIES = [{ id: 'c1', label: 'تجهيزات' }];

const ITEM = {
  id: 's1',
  itemName: 'رسوم تجهيز السكن',
  category: 'c1',
  quantity: 1,
  plannedAmount: 15000,
  units: [],
};

const FIVE = ['سكن الشمال', 'سكن الجنوب', 'سكن الغرب', 'سكن الشرق', 'سكن الوسط'];

const $ = (sel) => document.querySelector(sel);
const set = (sel, value) => fireEvent.change($(sel), { target: { value } });

function submit() {
  const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
  fireEvent.click(btn);
  fireEvent.submit(btn.closest('form'));
  return btn;
}

function renderEdit({ onUpdate = vi.fn(), item = ITEM } = {}) {
  render(
    <AddStartupFeeModal
      isOpen
      onClose={() => {}}
      onUpdate={onUpdate}
      categories={CATEGORIES}
      initialValues={item}
    />,
  );
  return onUpdate;
}

describe('AddStartupFeeModal — التقسيمات في الحمولة', () => {
  it('يُعبّئ المربّع من التقسيمات المحفوظة عند فتح التعديل', () => {
    renderEdit({ item: { ...ITEM, units: FIVE } });
    expect($('#unitsText').value).toBe(FIVE.join('\n'));
  });

  it('و`onUpdate` يستلم الأسماء مقسومةً — وهذا بالضبط ما كان مفقوداً', () => {
    const onUpdate = renderEdit();
    set('#unitsText', FIVE.join('\n'));
    submit();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0]).toBe('s1');
    expect(onUpdate.mock.calls[0][1].units).toEqual(FIVE);
  });

  it('والسطور الفارغة والمسافات تُنظَّف، لا تُحفظ سكناً بلا اسم', () => {
    const onUpdate = renderEdit();
    set('#unitsText', '  سكن الشمال  \n\n\n   \nسكن الجنوب\n');
    submit();
    expect(onUpdate.mock.calls[0][1].units).toEqual(['سكن الشمال', 'سكن الجنوب']);
  });

  it('ومربّعٌ فارغ يُرسل قائمةً فارغة — فيمكن مسح تقسيمات سابقة', () => {
    // `units` غائبةً تعني «اتركها كما هي» في `useStartupCosts.updateItem`،
    // فحذف كل الأسماء كان سيصير عملية لا يمكن إجراؤها.
    const onUpdate = renderEdit({ item: { ...ITEM, units: FIVE } });
    set('#unitsText', '');
    submit();
    expect(onUpdate.mock.calls[0][1].units).toEqual([]);
  });

  it('والإضافة الجديدة تحمل التقسيمات كذلك، لا التعديل وحده', () => {
    const onAdd = vi.fn();
    render(
      <AddStartupFeeModal isOpen onClose={() => {}} onAdd={onAdd} categories={CATEGORIES} />,
    );
    set('#itemName', 'رسوم تجهيز السكن');
    set('#quantity', '1');
    set('#plannedUnitPrice', '15000');
    set('#unitsText', 'سكن الشمال\nسكن الجنوب');
    submit();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].units).toEqual(['سكن الشمال', 'سكن الجنوب']);
  });
});

describe('AddStartupFeeModal — الرفض يُقال ولا يُبتلع', () => {
  it('الاسم المكرّر يمنع الحفظ ويقول السبب — ولا يُحذف بصمت', () => {
    // «النزهة» و«النزهه» مكانٌ واحد بإملاءين. القاعدة نفسها التي يطبّقها
    // الخادم، فلا تصير للعميل فكرة ثانية عن الاسم الصحيح.
    const onUpdate = renderEdit();
    set('#unitsText', 'سكن النزهة\nسكن النزهه');
    submit();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('مكرر');
  });

  it('والسطر الفارغ وسط الأسماء ليس خطأً — يُنظَّف ويمرّ', () => {
    const onUpdate = renderEdit();
    set('#unitsText', 'سكن الشمال\n\nسكن الجنوب');
    submit();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ورفضُ الخادم يظهر والنموذج يبقى مفتوحاً بقيمه', async () => {
    // كان يُغلق كأن الحفظ تمّ. الإغلاق على الرفض هو ما جعل العطل خفيّاً يوماً.
    const onClose = vi.fn();
    const onUpdate = vi.fn().mockRejectedValue(
      new Error('الخادم لم يحفظ التقسيمات — النسخة المنشورة أقدم من هذه الميزة.'),
    );
    render(
      <AddStartupFeeModal
        isOpen
        onClose={onClose}
        onUpdate={onUpdate}
        categories={CATEGORIES}
        initialValues={ITEM}
      />,
    );
    set('#unitsText', FIVE.join('\n'));
    submit();
    // انتظر دورة الوعد حتى يستقرّ الـ catch.
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toContain('أقدم من هذه الميزة');
    expect(onClose).not.toHaveBeenCalled();
    expect($('#unitsText').value).toBe(FIVE.join('\n'));
  });
});
