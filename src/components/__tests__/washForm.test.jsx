// @vitest-environment jsdom
/**
 * تسجيل الغسلات — المنتقي يكتب الاسم، لا المعرّف وحده
 * ═══════════════════════════════════════════════════════════════════════════
 * كان اسم البايكر نصاً حراً باقتراحات، فيُكتب «أحمد» مرةً و«احمد» أخرى ولا
 * يجمعهما شيء. صار منتقياً — والادعاء الحامل أن الحمولة ما زالت تحمل
 * **`bikerName` حرفياً** إلى جانب `bikerId`.
 *
 * ولماذا هذا هو الادعاء الحامل: ثلاثة مستهلكين يربطون بالاسم لا بالمعرّف —
 * `washStatsFor` في ملف البايكر، و`variableItemsForMonth` في سطر العمولات
 * (واختبار انجرافٍ يقفلهما معاً)، و`unregisteredBikerNames` الذي يغذّي زر
 * «استيراد الأسماء». فمنتقٍ يكتب المعرّف وحده يُفرغ الثلاثة بصمت.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AddWashModal from '../AddWashModal';

// السجل يأتي من `useBikers` — يُستبدل بقائمةٍ ثابتة كي يختبر الملف المودال
// وحده لا طبقة البيانات.
vi.mock('../../hooks/useBikers', () => ({
  useBikers: () => ({
    bikers: [
      { id: 'b1', name: 'أحمد محمد', salary: 2000 },
      { id: 'b2', name: 'سالم علي', salary: 1800 },
    ],
  }),
}));

afterEach(cleanup);

const $ = (sel) => document.querySelector(sel);
const set = (sel, value) => fireEvent.change($(sel), { target: { value } });

function submit() {
  const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
  fireEvent.click(btn);
  fireEvent.submit(btn.closest('form'));
  return btn;
}

const open = (props = {}) => render(
  <AddWashModal isOpen onClose={() => {}} {...props} />,
);

describe('AddWashModal — منتقي البايكر', () => {
  it('المنتقي يحمل البايكرية المسجّلين، ومعهم مخرج «اسم آخر»', () => {
    open({ onAdd: vi.fn() });
    const select = screen.getByLabelText(/البايكر المسؤول/);
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      '— بلا اسم —', 'أحمد محمد', 'سالم علي', 'اسم آخر (غير مسجّل)…',
    ]);
  });

  it('واختيار بايكر يُرسل الاسم والمعرّف معاً — لا المعرّف وحده', () => {
    const onAdd = vi.fn();
    open({ onAdd });
    set('#bikerPick', 'b1');
    set('#quantity', '12');
    set('#price', '20');
    submit();

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      bikerName: 'أحمد محمد',   // مفتاح الربط — بدونه تفرغ الإحصاءات والعمولات
      bikerId: 'b1',
      quantity: 12,
      price: 20,
      status: 'مكتملة',
    });
  });

  it('ولا خانة نصٍّ حرّة ما لم يُختَر «اسم آخر»', () => {
    open({ onAdd: vi.fn() });
    expect($('#bikerName')).toBeNull();
    set('#bikerPick', '__other__');
    expect($('#bikerName')).toBeTruthy();
  });

  it('و«اسم آخر» يُرسل النص المكتوب بلا معرّف — البديل المؤقت غسلةٌ تستحق التسجيل', () => {
    const onAdd = vi.fn();
    open({ onAdd });
    set('#bikerPick', '__other__');
    set('#bikerName', '  فريق الورديّة الصباحية  ');
    set('#quantity', '5');
    set('#price', '40');
    submit();

    expect(onAdd.mock.calls[0][0]).toMatchObject({
      bikerName: 'فريق الورديّة الصباحية',
      bikerId: null,
    });
  });

  it('و«بلا اسم» يبقى مسموحاً — غسلةٌ بلا اسم أفضل من غسلةٍ لا تُسجَّل', () => {
    const onAdd = vi.fn();
    open({ onAdd });
    set('#quantity', '3');
    set('#price', '40');
    submit();
    expect(onAdd.mock.calls[0][0]).toMatchObject({ bikerName: '', bikerId: null });
  });
});

describe('AddWashModal — التحرير', () => {
  const WASH = {
    id: 'w1', quantity: 10, price: 20, washDate: '2026-08-01', paymentMethod: 'cash',
  };

  it('غسلةٌ لبايكر مسجّل تُفتح على اسمه في المنتقي', () => {
    open({ onUpdate: vi.fn(), initialValues: { ...WASH, bikerName: 'أحمد محمد', bikerId: 'b1' } });
    expect($('#bikerPick').value).toBe('b1');
    expect($('#bikerName')).toBeNull();
  });

  it('وغسلةٌ قديمة باسمٍ حرّ تُفتح في «اسم آخر» بنصّها — ولا يُبدَّل اسمها بصمت', () => {
    const onUpdate = vi.fn();
    open({ onUpdate, initialValues: { ...WASH, bikerName: 'ابو راكان', bikerId: null } });
    expect($('#bikerPick').value).toBe('__other__');
    expect($('#bikerName').value).toBe('ابو راكان');

    submit();
    expect(onUpdate).toHaveBeenCalledWith('w1', expect.objectContaining({
      bikerName: 'ابو راكان',
      bikerId: null,
    }));
  });

  it('ومعرّفٌ لبايكر لم يعد في السجل يسقط إلى «اسم آخر» بالاسم المحفوظ', () => {
    // الملف حُذف من السجل بعد تسجيل الغسلة — الاسم يبقى، وهو ما تقرؤه
    // الإحصاءات، فيجب ألّا يختفي من الشاشة.
    open({ onUpdate: vi.fn(), initialValues: { ...WASH, bikerName: 'خالد', bikerId: 'gone' } });
    expect($('#bikerPick').value).toBe('__other__');
    expect($('#bikerName').value).toBe('خالد');
  });

  it('ولا يُرسل التحرير حالةً — الحالة تُقلب من الجدول وحده', () => {
    const onUpdate = vi.fn();
    open({ onUpdate, initialValues: { ...WASH, bikerName: 'أحمد محمد', bikerId: 'b1' } });
    submit();
    expect(onUpdate.mock.calls[0][1].status).toBeUndefined();
  });
});

describe('AddWashModal — العدد والسعر', () => {
  it('سعرٌ صفر لا يمرّ', () => {
    const onAdd = vi.fn();
    open({ onAdd });
    set('#quantity', '5');
    set('#price', '0');
    submit();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('والمعاينة = العدد × السعر', () => {
    open({ onAdd: vi.fn() });
    set('#quantity', '12');
    set('#price', '20');
    expect(document.body.textContent).toContain('240');
  });
});
