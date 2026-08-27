// @vitest-environment jsdom
/**
 * نوافذ تسويات سويتر — ما كان `prompt` يمرّره بصمت صار يُرفض بصوت
 * ═══════════════════════════════════════════════════════════════════════════
 * ثلاثة أسئلة كانت بـ`window.prompt`، ولكلٍّ عطبه غير الأتمتة:
 *
 *   • **كشف سويتر**: `Number(prompt(...))` على فراغٍ يعطي **صفراً**، فيُسجَّل
 *     كشفٌ بصفر ريال ويُنشئ فرقاً كاذباً بحجم مستحق الشهر كله.
 *   • **التحصيل**: سؤالان متتاليان — إلغاءُ الثاني يترك الأول بلا أثر،
 *     ونصٌّ في المبلغ يعطي `NaN` يذهب إلى الخادم.
 *   • **الإقفال**: السبب إلزامي عند وجود فروق، وكان نصّاً حرّاً بلا تحقق.
 *
 * فالادعاء الحامل هنا: **التحقق يمنع الإرسال ويقول السبب**، والإلغاء لا
 * ينفّذ شيئاً، والحمولة تصل بأنواعها الصحيحة.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SweaterSettlementsPage from '../SweaterSettlementsPage';

const PERIOD = '2026-05';

const FIGURES = {
  counts: { imported: 5, eligible: 3, excluded: 1, cancelled: 1, needsReview: 0, unknownStatus: 0 },
  services: { net: 231.3, vat: 34.7, gross: 266, count: 3 },
  deductions: 50, incentives: 0, compensations: 0, netDue: 216,
  pendingAdjustments: 0, pendingAdjustmentsTotal: 0,
  lines: { eligible: [], excluded: [], cancelled: [], review: [], unknown: [] },
};

const state = {
  canMutate: true,
  settlement: { periodKey: PERIOD, status: 'calculated', figures: FIGURES },
  variances: [],
  recordStatement: vi.fn(),
  recordCollection: vi.fn(),
  close: vi.fn(),
};

vi.mock('../../contexts/PartnerViewContext', () => ({
  usePartnerView: () => ({ canMutate: state.canMutate, scalingFactor: 1 }),
}));

vi.mock('../../hooks/useSweater', () => ({
  useSweaterSettlements: () => ({
    settlements: state.settlement ? [state.settlement] : [],
    loading: false, error: null, refetch: vi.fn(),
    calculate: vi.fn(), approve: vi.fn(),
    recordStatement: state.recordStatement,
    recordCollection: state.recordCollection,
    close: state.close,
  }),
  useSweaterBookings: () => ({ bookings: [], loading: false, error: null, refetch: vi.fn() }),
  useSweaterAdjustments: () => ({ adjustments: [], loading: false, error: null, refetch: vi.fn(), create: vi.fn(), approve: vi.fn() }),
  useSweaterVariances: () => ({ variances: state.variances, loading: false, error: null, refetch: vi.fn(), resolve: vi.fn() }),
}));

beforeEach(() => {
  state.canMutate = true;
  state.settlement = { periodKey: PERIOD, status: 'calculated', figures: FIGURES };
  state.variances = [];
  state.recordStatement = vi.fn().mockResolvedValue({});
  state.recordCollection = vi.fn().mockResolvedValue({});
  state.close = vi.fn().mockResolvedValue({});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const dialog = () => screen.queryByRole('dialog');
const btn = (re) => screen.getByRole('button', { name: re });
const confirmIn = (re) => [...dialog().querySelectorAll('button')].find((b) => re.test(b.textContent));

/** الفترة تُختار قبل كل شيء — الصفحة تبدأ على الشهر الحالي. */
function openPage() {
  render(<SweaterSettlementsPage />);
  fireEvent.change(screen.getByLabelText('الشهر'), { target: { value: PERIOD } });
}

describe('نافذة كشف سويتر', () => {
  const open = () => { openPage(); fireEvent.click(btn(/سجّل كشف سويتر/)); };

  it('تُفتح كنافذة داخلية وتعرض المتوقع للمقارنة', () => {
    open();
    expect(dialog()).toBeTruthy();
    expect(dialog().getAttribute('aria-label')).toMatch(/كشف سويتر/);
    expect(dialog().textContent).toMatch(/216/);
  });

  it('وفراغٌ لا يمرّ صفراً — العطب الذي كان يُنشئ فرقاً كاذباً', () => {
    open();
    fireEvent.click(confirmIn(/سجّل الكشف/));
    expect(state.recordStatement).not.toHaveBeenCalled();
    expect(dialog().textContent).toMatch(/مطلوب/);
  });

  it('ونصٌّ لا يستقرّ في الحقل أصلاً — فلا يصل الخادم', () => {
    // `type="number"` يرفض النصّ فيبقى الحقل فارغاً، وهو ما يمنع الإرسال.
    // وهذا أقوى من رسالة: القيمة الفاسدة لا تُكتب أصلاً. (والفرع الرقمي في
    // `fieldProblem` مُختبَرٌ مباشرةً في `sweaterDialogFields.test.js` لأنه
    // يحرس المسارات التي لا تمرّ بمدخلٍ رقمي.)
    open();
    const input = screen.getByLabelText(/صافي المستحق في الكشف/);
    fireEvent.change(input, { target: { value: 'مئتان' } });
    expect(input.value).toBe('');

    fireEvent.click(confirmIn(/سجّل الكشف/));
    expect(state.recordStatement).not.toHaveBeenCalled();
    expect(dialog().textContent).toMatch(/مطلوب/);
  });

  it('وسالبٌ يُرفض', () => {
    open();
    fireEvent.change(screen.getByLabelText(/صافي المستحق في الكشف/), { target: { value: '-5' } });
    fireEvent.click(confirmIn(/سجّل الكشف/));
    expect(state.recordStatement).not.toHaveBeenCalled();
  });

  it('والرقم يصل عدداً لا نصّاً', async () => {
    open();
    fireEvent.change(screen.getByLabelText(/صافي المستحق في الكشف/), { target: { value: '204.5' } });
    fireEvent.click(confirmIn(/سجّل الكشف/));

    await vi.waitFor(() => expect(state.recordStatement).toHaveBeenCalledTimes(1));
    expect(state.recordStatement).toHaveBeenCalledWith({ periodKey: PERIOD, statedNetDue: 204.5 });
  });

  it('وصفرٌ صريح مقبول — «الكشف صفر» حقيقةٌ تُسجَّل، بخلاف الفراغ', () => {
    open();
    fireEvent.change(screen.getByLabelText(/صافي المستحق في الكشف/), { target: { value: '0' } });
    fireEvent.click(confirmIn(/سجّل الكشف/));
    expect(state.recordStatement).toHaveBeenCalledWith({ periodKey: PERIOD, statedNetDue: 0 });
  });

  it('والإلغاء لا ينفّذ شيئاً', () => {
    open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(state.recordStatement).not.toHaveBeenCalled();
  });
});

describe('نافذة التحصيل — المبلغ والتاريخ معاً', () => {
  const open = () => { openPage(); fireEvent.click(btn(/سجّل تحصيلاً بنكياً/)); };

  it('حقلان في نافذةٍ واحدة — لا سؤالان متتاليان', () => {
    open();
    expect(screen.getByLabelText(/المبلغ المُحصَّل/)).toBeTruthy();
    expect(screen.getByLabelText(/تاريخ الاستلام/)).toBeTruthy();
  });

  it('وحقل التاريخ مدخلٌ أصيل قابل للكتابة — الوكيل يملؤه', () => {
    // `DateField` في هذا المشروع تقويمٌ بلا حقل كتابة، فلا يصلح هنا.
    open();
    const date = screen.getByLabelText(/تاريخ الاستلام/);
    expect(date.tagName).toBe('INPUT');
    expect(date.type).toBe('date');
    expect(date.getAttribute('aria-hidden')).toBeNull();
    expect(date.tabIndex).not.toBe(-1);
  });

  it('ومبلغٌ صفر يُرفض — تحصيلٌ بصفر ليس تحصيلاً', () => {
    open();
    fireEvent.change(screen.getByLabelText(/المبلغ المُحصَّل/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/تاريخ الاستلام/), { target: { value: '2026-06-10' } });
    fireEvent.click(confirmIn(/سجّل التحصيل/));

    expect(state.recordCollection).not.toHaveBeenCalled();
    expect(dialog().textContent).toMatch(/أكبر من صفر/);
  });

  it('وتاريخٌ ناقص يمنع الإرسال ولو صحّ المبلغ', () => {
    open();
    fireEvent.change(screen.getByLabelText(/المبلغ المُحصَّل/), { target: { value: '216' } });
    fireEvent.click(confirmIn(/سجّل التحصيل/));
    expect(state.recordCollection).not.toHaveBeenCalled();
  });

  it('والاثنان معاً يصلان بأنواعهما', async () => {
    open();
    fireEvent.change(screen.getByLabelText(/المبلغ المُحصَّل/), { target: { value: '216' } });
    fireEvent.change(screen.getByLabelText(/تاريخ الاستلام/), { target: { value: '2026-06-10' } });
    fireEvent.click(confirmIn(/سجّل التحصيل/));

    await vi.waitFor(() => expect(state.recordCollection).toHaveBeenCalledTimes(1));
    expect(state.recordCollection).toHaveBeenCalledWith({
      periodKey: PERIOD, amount: 216, receivedDate: '2026-06-10',
    });
  });

  it('ورفضُ الخادم يبقيها مفتوحةً بقيمها', async () => {
    state.recordCollection = vi.fn().mockRejectedValue(new Error('الفترة مقفلة'));
    open();
    fireEvent.change(screen.getByLabelText(/المبلغ المُحصَّل/), { target: { value: '216' } });
    fireEvent.change(screen.getByLabelText(/تاريخ الاستلام/), { target: { value: '2026-06-10' } });
    fireEvent.click(confirmIn(/سجّل التحصيل/));

    await vi.waitFor(() => expect(dialog().textContent).toMatch(/الفترة مقفلة/));
    expect(screen.getByLabelText(/المبلغ المُحصَّل/).value).toBe('216');
  });
});

describe('نافذة الإقفال', () => {
  const open = () => { openPage(); fireEvent.click(btn(/أقفل التسوية/)); };

  it('بلا فروق: لا حقل سبب، والتأكيد يمرّ بـ`null`', async () => {
    open();
    expect(screen.queryByLabelText(/سبب الإقفال/)).toBeNull();
    fireEvent.click(confirmIn(/أقفل التسوية/));

    await vi.waitFor(() => expect(state.close).toHaveBeenCalledTimes(1));
    expect(state.close).toHaveBeenCalledWith(PERIOD, null);
  });

  it('ومع فروقٍ غير محلولة: السبب إلزامي ويُذكر عددها', () => {
    state.variances = [{ id: 'v1', resolution: 'unresolved' }, { id: 'v2', resolution: 'unresolved' }];
    open();
    expect(dialog().textContent).toMatch(/2/);
    fireEvent.click(confirmIn(/أقفل التسوية/));

    expect(state.close).not.toHaveBeenCalled();
    expect(dialog().textContent).toMatch(/مطلوب/);
  });

  it('ومع السبب يمرّ ويصل نصّاً مُشذَّباً', async () => {
    state.variances = [{ id: 'v1', resolution: 'unresolved' }];
    open();
    fireEvent.change(screen.getByLabelText(/سبب الإقفال/), { target: { value: '  قيد التفاوض  ' } });
    fireEvent.click(confirmIn(/أقفل التسوية/));

    await vi.waitFor(() => expect(state.close).toHaveBeenCalledWith(PERIOD, 'قيد التفاوض'));
  });

  it('والفرق المحسوم لا يُلزم بسبب', async () => {
    state.variances = [{ id: 'v1', resolution: 'accepted' }];
    open();
    fireEvent.click(confirmIn(/أقفل التسوية/));
    await vi.waitFor(() => expect(state.close).toHaveBeenCalledWith(PERIOD, null));
  });

  it('والإلغاء بالنقر خارجها لا يُقفل شيئاً', () => {
    state.variances = [{ id: 'v1', resolution: 'unresolved' }];
    open();
    fireEvent.click(screen.getByTestId('sweater-dialog-backdrop'));
    expect(dialog()).toBeNull();
    expect(state.close).not.toHaveBeenCalled();
  });
});

describe('من لا يملك التعديل لا يرى الأفعال', () => {
  it('لا أزرار ولا نوافذ', () => {
    state.canMutate = false;
    openPage();
    expect(screen.queryByRole('button', { name: /سجّل كشف سويتر/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /أقفل التسوية/ })).toBeNull();
    expect(dialog()).toBeNull();
  });
});
