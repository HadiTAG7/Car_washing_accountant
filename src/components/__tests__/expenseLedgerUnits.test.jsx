// @vitest-environment jsdom
/**
 * التقسيمات داخل البند — المُنتقي مرئي، والقائمة مقسومة، والاختيار يصل
 * ═══════════════════════════════════════════════════════════════════════════
 * المستخدم أنشأ خمسة سكنات ثم سأل: «كيف أضيف الفواتير في التقسيمات؟» — وهو
 * سؤالٌ لا يُطرح لو أجابت الواجهة عن نفسها. الفحص وجد ثلاثة عيوب في شحنةٍ
 * واحدة، وهذا الملف يحرسها الثلاثة:
 *
 * ١) `Home` و`Wand2` استُعملتا في JSX ولم تُستورَدا. `no-undef` لا يفحص
 *    `JSXIdentifier` و esbuild لا يفحص شيئاً، فمرّتا خضراوين — وانفجرتا في
 *    المتصفّح بـ ReferenceError لحظة `hasUnits`. أي أن البند الوحيد الذي له
 *    تقسيمات هو البند الوحيد الذي لا يُفتح. مجرّد رندر هذا المكوّن بتقسيمات
 *    يمسك ذلك.
 *
 * ٢) المُنتقي وُضع ثالثاً في شبكةٍ من عمودين، فسقط في خليّة 180px تحت المبلغ
 *    بلا عنوان. `getByLabelText` هو الفرق بين «موجود في DOM» و«يمكن العثور
 *    عليه» — والثاني هو ما طلبه المستخدم.
 *
 * ٣) `handleAdd` لم يُرسل `unit` أصلاً. لولا هذا الاختبار لكان المُنتقي
 *    زينةً: تختار السكن، ويُحفظ المصروف «غير محدد»، ولا شيء يقول لك.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ExpenseLedgerModal from '../ExpenseLedgerModal';

afterEach(cleanup);

const UNITS = ['سكن النزهة', 'سكن الشمال', 'سكن الروضة'];

const ENTRIES = [
  { id: 'e1', description: 'مروحة سقف', amount: 1200, spentDate: '2026-08-01', unit: 'سكن النزهة' },
  { id: 'e2', description: 'ثلاجة',     amount: 800,  spentDate: '2026-08-02', unit: 'سكن النزهة' },
  { id: 'e3', description: 'دهان عام',  amount: 500,  spentDate: '2026-08-03' },
  { id: 'e4', description: 'سرير',      amount: 300,  spentDate: '2026-08-04', unit: 'سكن الشمال' },
];

function renderLedger({
  units = null, entries = ENTRIES, addEntry = vi.fn(), onAssignUnits = null,
} = {}) {
  render(
    <ExpenseLedgerModal
      isOpen
      onClose={() => {}}
      title="سجل مصاريف: رسوم تجهيز السكن"
      plannedAmount={15000}
      units={units}
      onAssignUnits={onAssignUnits}
      ledger={{
        entries,
        loading: false,
        error: null,
        addEntry,
        deleteEntry: vi.fn(),
      }}
    />,
  );
  return { addEntry };
}

const $ = (sel) => document.querySelector(sel);
const set = (sel, value) => fireEvent.change($(sel), { target: { value } });

// `Intl` يغلّف المبلغ بعلامات الاتجاه (U+200F) — غير مرئية، وتكسر المقارنة
// النصّية. تُنزَع هنا لا في المكوّن: وجودها في الصفحة صحيح.
const clean = (s) => s.replace(/[‎‏؜]/g, '').replace(/\s+/g, ' ').trim();

/** صفوف القائمة مصنّفةً: الرأس بلا زر حذف، والمصروف يحمله. */
function rows() {
  const ul = document.querySelector('ul');
  return [...ul.children].map((li) => ({
    text: clean(li.textContent),
    isHeader: !li.querySelector('button[aria-label^="حذف"]'),
  }));
}

const indexOfRow = (needle) => rows().findIndex((r) => r.text.includes(needle));

function submit() {
  const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
  // النقر هو ما يفعله المستخدم، والإرسال المباشر هو الحزام: `handleAdd`
  // يتجاهل الزر المعطَّل لو دخل أحدهم على Enter.
  fireEvent.click(btn);
  fireEvent.submit(btn.closest('form'));
  return btn;
}

// ═══════════════════════════════════════════════════════════════════════════
// بندٌ له تقسيمات
// ═══════════════════════════════════════════════════════════════════════════
describe('ExpenseLedgerModal — بند له تقسيمات', () => {
  it('يُرسَم أصلاً بلا انفجار — الأيقونات مستورَدة', () => {
    // `<Home/>` و`<Wand2/>` غير المستورَدتين ترفعان ReferenceError هنا لا في
    // الـ lint ولا في الـ build. هذا السطر وحده هو ما كان يفصل الشحنة عن
    // شاشةٍ بيضاء عند المستخدم.
    expect(() => renderLedger({ units: UNITS })).not.toThrow();
    expect(document.body.textContent).toContain('رسوم تجهيز السكن');
  });

  it('والمُنتقي له تسميةٌ يمكن العثور عليها، وخياراته هي التقسيمات', () => {
    renderLedger({ units: UNITS });
    const select = screen.getByLabelText('التقسيم الذي يخصّه هذا المصروف');
    expect(select.tagName).toBe('SELECT');
    // الخيار الأول فراغٌ صريح — «غير محدد» قرارٌ لا سهو.
    expect([...select.options].map((o) => o.value)).toEqual(['', ...UNITS]);
  });

  it('والقائمة أقسامٌ برؤوسها: الاسم والعدد والمجموع', () => {
    renderLedger({ units: UNITS });
    const head = rows().filter((r) => r.isHeader);
    expect(head.map((r) => r.text)).toEqual([
      'سكن النزهة(2)2,000 ر.س',
      'سكن الشمال(1)300 ر.س',
      'سكن الروضة(0)0 ر.س',
      'غير محدد(1)500 ر.س',
    ]);
    // ومجموع الرؤوس = مجموع البند: 2,000 + 300 + 0 + 500 = 2,800 وهو
    // «المسجّل» في الشريط أعلى المودال. الإسناد لا يحرّك ريالاً.
    expect(clean(document.body.textContent)).toContain('2,800 ر.س');
  });

  it('والمصروف يقع تحت رأس تقسيمه لا في قائمةٍ مسطّحة', () => {
    renderLedger({ units: UNITS });
    // ترتيب DOM هو الادعاء كله: قبل «مروحة سقف» رأسُ النزهة، وبعدها وقبل
    // «سرير» رأسُ الشمال. قائمةٌ مسطّحة تكسر هذا حتماً.
    expect(indexOfRow('سكن النزهة')).toBeLessThan(indexOfRow('مروحة سقف'));
    expect(indexOfRow('مروحة سقف')).toBeLessThan(indexOfRow('سكن الشمال'));
    expect(indexOfRow('سكن الشمال')).toBeLessThan(indexOfRow('سرير'));
    // و«غير محدد» آخر رأسٍ دائماً، ومصروفه بعده.
    expect(indexOfRow('غير محدد')).toBeLessThan(indexOfRow('دهان عام'));
    expect(indexOfRow('دهان عام')).toBe(rows().length - 1);
  });

  it('وتقسيمٌ لم يُصرف عليه شيء يبقى ظاهراً بصفر — القائمة تصف الواقع', () => {
    renderLedger({ units: UNITS });
    const rowsNow = rows();
    const i = rowsNow.findIndex((r) => r.text.includes('سكن الروضة'));
    expect(i).toBeGreaterThan(-1);
    // ولا مصروف تحته: الصف التالي رأسٌ آخر (أو نهاية القائمة).
    expect(rowsNow[i + 1]?.isHeader ?? true).toBe(true);
  });

  it('و`addEntry` يستلم التقسيم المختار — وإلا فالمُنتقي زينة', () => {
    const addEntry = vi.fn();
    renderLedger({ units: UNITS, addEntry });
    set('input[name="description"]', 'مكيّف سبليت');
    set('input[name="amount"]', '2500');
    set('select[name="unit"]', 'سكن الشمال');
    submit();

    expect(addEntry).toHaveBeenCalledTimes(1);
    expect(addEntry.mock.calls[0][0]).toMatchObject({
      description: 'مكيّف سبليت',
      amount: 2500,
      unit: 'سكن الشمال',
    });
  });

  it('وتركُه فارغاً يُرسل «بلا تقسيم» صراحةً لا `undefined`', () => {
    const addEntry = vi.fn();
    renderLedger({ units: UNITS, addEntry });
    set('input[name="description"]', 'أدوات نظافة');
    set('input[name="amount"]', '90');
    submit();
    expect(addEntry.mock.calls[0][0].unit).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// المصاريف المسجّلة قبل التقسيمات — الطريق إلى لوحة التوزيع
// ═══════════════════════════════════════════════════════════════════════════
// هذا المسار لم يُنفَّذ في متصفّحٍ قط: الزر خلف `hasUnits`، و`hasUnits` كان
// ينفجر. فيُختبَر من أوّله — الزر، ثم اللوحة، ثم ما يصل إلى الخادم.
describe('ExpenseLedgerModal — توزيع المصاريف القديمة', () => {
  const OLD = [
    { id: 'x1', description: 'تزويد سكن النزهه بمروحة اضافية', amount: 139, spentDate: '2026-07-01' },
    { id: 'x2', description: 'دهان عام', amount: 200, spentDate: '2026-07-02' },
  ];

  it('الزر يظهر بعدد ما لم يُسنَد، واللوحة تفتح بالاقتراح لا بالحفظ', () => {
    const onAssignUnits = vi.fn();
    renderLedger({ units: UNITS, entries: OLD, onAssignUnits });

    const btn = screen.getByRole('button', { name: /اقتراح توزيع/ });
    expect(clean(btn.textContent)).toContain('2');
    fireEvent.click(btn);

    // لا شيء كُتب بمجرّد الفتح.
    expect(onAssignUnits).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('توزيع مقترح على السكنات');
    // «سكن النزهه» في الوصف ⇒ «سكن النزهة» في القائمة، رغم ة/ه.
    expect(screen.getByLabelText('سكن تزويد سكن النزهه بمروحة اضافية').value).toBe('سكن النزهة');
    expect(screen.getByLabelText('سكن دهان عام').value).toBe('');
  });

  it('والتأكيد يرسل ما اختير فقط — والمجهول يبقى «غير محدد»', async () => {
    const onAssignUnits = vi.fn().mockResolvedValue({});
    renderLedger({ units: UNITS, entries: OLD, onAssignUnits });
    fireEvent.click(screen.getByRole('button', { name: /اقتراح توزيع/ }));
    fireEvent.click(screen.getByRole('button', { name: /تأكيد توزيع/ }));

    expect(onAssignUnits).toHaveBeenCalledTimes(1);
    expect(onAssignUnits.mock.calls[0][0]).toEqual([
      { entryId: 'x1', unit: 'سكن النزهة' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// بندٌ بلا تقسيمات — المصاريف السنوية تشارك هذا المكوّن حرفياً
// ═══════════════════════════════════════════════════════════════════════════
describe('ExpenseLedgerModal — بند بلا تقسيمات', () => {
  it('لا منتقي ولا رؤوس: غياب الخصائص يعني غياب كل شيء', () => {
    renderLedger({ units: null });
    expect(screen.queryByLabelText('التقسيم الذي يخصّه هذا المصروف')).toBeNull();
    expect(rows().every((r) => !r.isHeader)).toBe(true);
    expect(rows()).toHaveLength(ENTRIES.length);
  });

  it('وقائمةٌ فارغة من التقسيمات تُعامَل كغيابها', () => {
    renderLedger({ units: [] });
    expect(screen.queryByLabelText('التقسيم الذي يخصّه هذا المصروف')).toBeNull();
    expect(rows()).toHaveLength(ENTRIES.length);
  });

  it('و`addEntry` لا يحمل تقسيماً حين لا تقسيم', () => {
    const addEntry = vi.fn();
    renderLedger({ units: null, addEntry });
    set('input[name="description"]', 'رخصة بلدية');
    set('input[name="amount"]', '1200');
    submit();
    expect(addEntry).toHaveBeenCalledTimes(1);
    expect(addEntry.mock.calls[0][0].unit).toBeUndefined();
  });
});
