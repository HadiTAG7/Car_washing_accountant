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
  updateEntry = undefined,
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
        updateEntry,
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

  it('ورفضُ الخادم يُقرأ على الشاشة، والقيم تبقى في النموذج', async () => {
    // كان `try`/`finally` بلا `catch`، ولا ErrorBoundary في التطبيق: فرسالةٌ
    // كتبها الخادم بالعربية لهذا المستخدم تموت في الـ console — يتوقّف المؤشّر
    // ولا يُضاف شيء ولا يُقال لماذا.
    const addEntry = vi.fn().mockRejectedValue(
      new Error('«سكن الروضة» ليس من سكنات هذا البند. أضِفه إلى قائمة السكنات أولاً.'),
    );
    renderLedger({ units: UNITS, addEntry });
    set('input[name="description"]', 'مكيّف');
    set('input[name="amount"]', '2500');
    submit();

    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('ليس من سكنات هذا البند');
    // الفاتورة لا تُعاد كتابتها: القيم في مكانها ليصحّح الحقل الذي سُمّي.
    expect($('input[name="description"]').value).toBe('مكيّف');
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

  it('والبحث يضيّق الصفوف رغم ة/ه، و«عيّن الظاهر» يمسّ المُرشَّح وحده', () => {
    // «أي شي في سكن النزهة اعتبره في الشمال» — قاعدةٌ يعرفها المالك وحده،
    // فتُنفَّذ بخطوتين بدل أن تُرمَّز في الشيفرة.
    const onAssignUnits = vi.fn();
    renderLedger({ units: UNITS, entries: OLD, onAssignUnits });
    fireEvent.click(screen.getByRole('button', { name: /اقتراح توزيع/ }));

    // «النزهة» بالتاء المربوطة تجد «النزهه» في الوصف.
    fireEvent.change(screen.getByLabelText('ابحث في وصف المصاريف'), {
      target: { value: 'النزهة' },
    });
    expect(screen.queryByLabelText('سكن دهان عام')).toBeNull();

    const bulk = screen.getByLabelText(/عيّن 1 مصروفاً ظاهراً/);
    fireEvent.change(bulk, { target: { value: 'سكن الشمال' } });

    // المُرشَّح تغيّر، والمخفيّ لم يُمَسّ.
    expect(screen.getByLabelText('سكن تزويد سكن النزهه بمروحة اضافية').value)
      .toBe('سكن الشمال');
    fireEvent.change(screen.getByLabelText('ابحث في وصف المصاريف'), { target: { value: '' } });
    expect(screen.getByLabelText('سكن دهان عام').value).toBe('');
    // ولا كتابة بعد — الحفظ بزر التأكيد وحده.
    expect(onAssignUnits).not.toHaveBeenCalled();
  });

  it('وتصحيح المستخدم يبقى بعد أي رندر للأب — لا يمحوه الاقتراح', () => {
    // `unitList` كان يُبنى كل رندر بهوية جديدة، فيبطل `useMemo` في اللوحة
    // ويعيد `useEffect` كتابة الاختيارات باقتراحات الآلة. حرفٌ واحد في نموذج
    // الإضافة فوقها كان يكفي لمسح مراجعةً كاملة.
    renderLedger({ units: UNITS, entries: OLD, onAssignUnits: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: /اقتراح توزيع/ }));

    const row = screen.getByLabelText('سكن تزويد سكن النزهه بمروحة اضافية');
    expect(row.value).toBe('سكن النزهة');          // الاقتراح
    fireEvent.change(row, { target: { value: 'سكن الروضة' } }); // تصحيح المستخدم

    // رندر للأب: حرفٌ في وصف المصروف الجديد.
    set('input[name="description"]', 'أ');
    expect(screen.getByLabelText('سكن تزويد سكن النزهه بمروحة اضافية').value)
      .toBe('سكن الروضة');
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

// ═══════════════════════════════════════════════════════════════════════════
// تعديل مصروف مسجَّل
// ═══════════════════════════════════════════════════════════════════════════
// «أبغى أعدّل في اسم الفواتير — حالياً ما أقدر.» صحيح: لم يكن هناك استدعاء
// تعديل أصلاً. وما يحرسه هذا الملف هو نصف الواجهة: أن القلم يظهر فقط حين
// يملك السجلّ استدعاءً، وأن النموذج يُعبَّأ بالقيم القائمة، وأن ما يصل
// `updateEntry` هو المعرّف والحمولة كاملةً.
describe('ExpenseLedgerModal — تعديل مصروف', () => {
  it('لا قلم حين لا يملك السجلّ استدعاء تعديل — المصاريف السنوية تشارك المكوّن', () => {
    renderLedger({ units: UNITS });
    expect(screen.queryByLabelText(/^تعديل /)).toBeNull();
  });

  it('والقلم يُعبّئ النموذج بقيم المصروف ويقلبه إلى وضع تعديل', () => {
    renderLedger({ units: UNITS, updateEntry: vi.fn() });
    fireEvent.click(screen.getByLabelText('تعديل مروحة سقف'));

    expect($('input[name="description"]').value).toBe('مروحة سقف');
    expect($('input[name="amount"]').value).toBe('1200');
    expect($('select[name="unit"]').value).toBe('سكن النزهة');
    expect(clean(document.body.textContent)).toContain('تعديل مصروف مسجَّل');
    const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
    expect(clean(btn.textContent)).toBe('حفظ التعديل');
  });

  it('و`updateEntry` يستلم المعرّف والحمولة — لا `addEntry`', () => {
    const updateEntry = vi.fn();
    const addEntry = vi.fn();
    renderLedger({ units: UNITS, updateEntry, addEntry });
    fireEvent.click(screen.getByLabelText('تعديل مروحة سقف'));
    set('input[name="description"]', 'مروحة سقف — سكن الشمال');
    set('select[name="unit"]', 'سكن الشمال');
    submit();

    expect(addEntry).not.toHaveBeenCalled();
    expect(updateEntry).toHaveBeenCalledTimes(1);
    expect(updateEntry.mock.calls[0][0]).toBe('e1');
    expect(updateEntry.mock.calls[0][1]).toMatchObject({
      description: 'مروحة سقف — سكن الشمال',
      unit: 'سكن الشمال',
      amount: 1200,
      spentDate: '2026-08-01',
    });
  });

  it('و«إلغاء التعديل» يعيد النموذج فارغاً إلى وضع الإضافة', () => {
    renderLedger({ units: UNITS, updateEntry: vi.fn() });
    fireEvent.click(screen.getByLabelText('تعديل مروحة سقف'));
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء التعديل' }));

    expect($('input[name="description"]').value).toBe('');
    const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
    expect(clean(btn.textContent)).toBe('إضافة المصروف');
  });

  it('ورفضُ الخادم للتعديل يُقرأ، والنموذج يبقى في وضع التعديل', async () => {
    // رسالة «المبلغ والتاريخ لا تتغيّر بعد الترحيل» يكتبها الخادم لهذا
    // المستخدم — فلو ابتُلعت لظنّ أن التعديل تمّ.
    const updateEntry = vi.fn().mockRejectedValue(
      new Error('هذا المصروف مُرحّل بالقيد رقم 12 — المبلغ والتاريخ لا تتغيّر بعده.'),
    );
    renderLedger({ units: UNITS, updateEntry });
    fireEvent.click(screen.getByLabelText('تعديل مروحة سقف'));
    set('input[name="amount"]', '900');
    submit();

    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('مُرحّل بالقيد رقم');
    expect($('input[name="amount"]').value).toBe('900');
  });
});
