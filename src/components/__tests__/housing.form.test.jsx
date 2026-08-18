// @vitest-environment jsdom
/**
 * مودال بيانات السكن — الفراغ يصل null لا صفراً، والرفض يُقال
 * ═══════════════════════════════════════════════════════════════════════════
 * The claim under test is the PAYLOAD: capacity left empty must travel as
 * `null` («لم تُذكر»), never as 0 — a zero would render every unit as
 * over-capacity the moment one resident is linked. And a server refusal must
 * keep the modal open with its values, not close as though it saved.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import EditHousingUnitModal from '../EditHousingUnitModal';

afterEach(cleanup);

const UNIT = { key: 'k1', name: 'سكن الشمال', capacity: null, notes: '' };

const $ = (sel) => document.querySelector(sel);
const set = (sel, value) => fireEvent.change($(sel), { target: { value } });

function submit() {
  const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
  // النقر هو ما يفعله المستخدم، والإرسال المباشر هو الحزام.
  fireEvent.click(btn);
  fireEvent.submit(btn.closest('form'));
  return btn;
}

describe('EditHousingUnitModal', () => {
  it('السعة الفارغة تصل null لا 0 — «لم تُذكر» و«صفر» حقيقتان مختلفتان', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(<EditHousingUnitModal isOpen onClose={() => {}} unit={UNIT} onSave={onSave} />);
    set('#housingNotes', '  عقد 4821  ');
    submit();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual({ capacity: null, notes: 'عقد 4821' });
  });

  it('والرقم يصل عدداً صحيحاً', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(<EditHousingUnitModal isOpen onClose={() => {}} unit={UNIT} onSave={onSave} />);
    set('#housingCapacity', '14');
    submit();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].capacity).toBe(14);
  });

  it('وسعة قائمة تُعبَّأ في الحقل، وnull يُعبَّأ فراغاً لا «0»', () => {
    render(
      <EditHousingUnitModal
        isOpen onClose={() => {}} onSave={vi.fn()}
        unit={{ ...UNIT, capacity: 16, notes: 'قديمة' }}
      />,
    );
    expect($('#housingCapacity').value).toBe('16');
    cleanup();
    render(<EditHousingUnitModal isOpen onClose={() => {}} onSave={vi.fn()} unit={UNIT} />);
    expect($('#housingCapacity').value).toBe('');
  });

  it('وصفر أو سالب لا يمرّ — سعة سكنٍ إمّا عددٌ موجب وإمّا لم تُذكر', () => {
    const onSave = vi.fn();
    render(<EditHousingUnitModal isOpen onClose={() => {}} unit={UNIT} onSave={onSave} />);
    set('#housingCapacity', '0');
    submit();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('ورفضُ الحفظ يُعرَض والمودال يبقى مفتوحاً بقيمه', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error('تم رفض الطلب بواسطة قواعد الأمان'));
    render(<EditHousingUnitModal isOpen onClose={onClose} unit={UNIT} onSave={onSave} />);
    set('#housingCapacity', '14');
    submit();

    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('قواعد الأمان');
    expect(onClose).not.toHaveBeenCalled();
    expect($('#housingCapacity').value).toBe('14');
  });
});
