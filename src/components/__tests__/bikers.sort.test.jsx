// @vitest-environment jsdom
/**
 * ترتيب جدول البايكر بالنقر على رأس العمود
 * ═══════════════════════════════════════════════════════════════════════════
 * «ابغى ترتيبهم أنا أحدده — على الكفيل، أو الجنسية، أو السكن». والمنطق نفسه
 * مُختبَرٌ صافياً في `bikerSort.test.js`؛ هنا يُختبر ما لا يظهر إلا في متصفح:
 *
 *  ١. أن النقرة تصل أصلاً — الرأس **زرّ** لا `<th onClick>`، فتصله لوحة
 *     المفاتيح وقارئ الشاشة.
 *  ٢. أن `aria-sort` يقول بأي عمودٍ رُتّبت القائمة — وهو المَعْلَم الوحيد
 *     الذي يقرأه القارئ الآلي ليعرف الحالة.
 *  ٣. **أن التركيز لا يضيع بعد النقر.** وهذا هو الادعاء الذي يستحق اختباراً
 *     سلوكياً: `SortableTh` مُعرَّفٌ داخل جسم المكوّن، فهويّته تتغيّر كل
 *     رسمة. ولو أعاد React تركيب الخليّة بدل تحديثها لَذهب التركيز إلى
 *     `<body>`، فيفقد مستخدم لوحة المفاتيح موضعه عند أول نقرة — ولا يستطيع
 *     الضغط ثانيةً ليعكس الاتجاه دون البحث عن الزر من جديد.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

const BIKERS = [
  { id: '1', name: 'خالد', sponsor: 'مؤسسة النور', nationality: 'باكستاني', residence: 'سكن الغرب', salary: 1800 },
  { id: '2', name: 'أحمد', sponsor: 'شركة الفجر', nationality: 'بنغلاديشي', residence: 'سكن الشمال', salary: 2200 },
  { id: '3', name: 'سالم', sponsor: null, nationality: 'هندي', residence: null, salary: 2000 },
];

vi.mock('../../hooks/useBikers', () => ({
  useBikers: () => ({
    bikers: BIKERS, loading: false, error: null,
    addBiker: vi.fn(), updateBiker: vi.fn(), deleteBiker: vi.fn(), refetch: vi.fn(),
  }),
}));
vi.mock('../../hooks/useWashes', () => ({
  useWashes: () => ({ washes: [], loading: false, error: null }),
}));
vi.mock('../../hooks/useTemporaryExpenses', () => ({
  useTemporaryExpenses: () => ({ expenses: [], loading: false, error: null, addExpense: vi.fn(), refetch: vi.fn() }),
}));
vi.mock('../../contexts/PartnerViewContext', () => ({
  usePartnerView: () => ({ activePartner: null, scalingFactor: 1, isPartnerView: false }),
}));

const { default: BikersPage } = await import('../BikersPage');

/** أسماء البايكرين بترتيب ظهورهم في الجدول. */
const namesInTable = () => {
  const table = document.querySelector('table');
  return [...table.querySelectorAll('tbody tr')]
    .map((tr) => tr.querySelector('td')?.textContent?.trim())
    .filter(Boolean)
    .map((t) => t.split('\n')[0].trim());
};

const header = (label) => screen.getByTitle(`ترتيب حسب ${label}`);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('ترتيب جدول البايكر', () => {
  it('رأس العمود زرٌّ تصله لوحة المفاتيح — لا خليّةٌ عليها onClick', () => {
    render(<BikersPage role="admin" />);
    for (const label of ['الكفيل', 'الجنسية', 'السكن', 'الاسم']) {
      expect(header(label).tagName, label).toBe('BUTTON');
    }
  });

  it('النقر على «الكفيل» يرتّب به — والفارغ يذهب للذيل', () => {
    render(<BikersPage role="admin" />);
    fireEvent.click(header('الكفيل'));
    const rows = namesInTable();
    // «شركة الفجر» قبل «مؤسسة النور» — الأبجدية العربية: ش قبل م.
    expect(rows.slice(0, 2)).toEqual(['أحمد', 'خالد']);
    expect(rows[2]).toBe('سالم');   // بلا كفيل
  });

  it('والنقرة الثانية تعكس الاتجاه، والفارغ يبقى في الذيل', () => {
    render(<BikersPage role="admin" />);
    fireEvent.click(header('الكفيل'));
    fireEvent.click(header('الكفيل'));
    const rows = namesInTable();
    expect(rows.slice(0, 2)).toEqual(['خالد', 'أحمد']);
    expect(rows[2]).toBe('سالم');   // لم يقفز للأعلى بعكس الاتجاه
  });

  it('و`aria-sort` يعلن العمود والاتجاه — مَعْلَم القارئ الآلي الوحيد', () => {
    render(<BikersPage role="admin" />);
    const th = () => header('الجنسية').closest('th');
    expect(th().getAttribute('aria-sort')).toBe('none');
    fireEvent.click(header('الجنسية'));
    expect(th().getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(header('الجنسية'));
    expect(th().getAttribute('aria-sort')).toBe('descending');
    // وعمودٌ آخر يُخلي الأول.
    fireEvent.click(header('السكن'));
    expect(th().getAttribute('aria-sort')).toBe('none');
  });

  it('والتركيز يبقى على الزر بعد النقر — فتُعكس الوجهة بضغطةٍ ثانية', () => {
    render(<BikersPage role="admin" />);
    const btn = header('الكفيل');
    btn.focus();
    expect(document.activeElement).toBe(btn);

    fireEvent.click(btn);

    // لو أعاد React تركيب الخليّة لصار `activeElement` هو `<body>`،
    // ولَعجز مستخدم لوحة المفاتيح عن الضغط ثانيةً دون البحث من جديد.
    expect(document.activeElement, 'ضاع التركيز بعد النقر').toBe(header('الكفيل'));
  });

  it('والتفضيل يُحفظ فيبقى بين الزيارات', () => {
    const { unmount } = render(<BikersPage role="admin" />);
    fireEvent.click(header('الجنسية'));
    unmount();

    render(<BikersPage role="admin" />);
    expect(header('الجنسية').closest('th').getAttribute('aria-sort')).toBe('ascending');
    expect(namesInTable().slice(0, 3)).toEqual(['خالد', 'أحمد', 'سالم']);
  });

  it('وتخزينٌ فاسد لا يُسقط الصفحة — تعود للاسم', () => {
    window.localStorage.setItem('mw:bikerSort', '{{ليس JSON');
    render(<BikersPage role="admin" />);
    expect(header('الاسم').closest('th').getAttribute('aria-sort')).toBe('ascending');
  });
});
