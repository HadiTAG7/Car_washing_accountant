// @vitest-environment jsdom
/**
 * بوابة تكامل سويتر — الزرّ يظهر، والنافذة تُدار، والسرّ يُعرض مرة واحدة
 * ═══════════════════════════════════════════════════════════════════════════
 * انحداران حقيقيان وقعا هنا، وهذا الملف يحرسهما معاً:
 *
 * ١) `actions` بدل `action` على `SectionHeader` أخفت الزرّ **حتى عن المدير**
 *    — بلا خطأ ولا تحذير، لأن React يُسقط الخاصية المجهولة بصمت.
 * ٢) `window.prompt` أوقف الوكيل الرابع عند أول نقرة: محجوبٌ في المتصفح
 *    الآلي. ولا يظهر ذلك في jsdom إطلاقاً — `prompt` موجودٌ هنا ويرجع `null`
 *    — فالحارس النصّي في `sweaterNoPrompt.test.js` هو ما يمنع عودته، وهذا
 *    الملف يُثبت أن **البديل يعمل**.
 *
 * والادعاء الأمني الثابت: **السرّ يُعرض مرة واحدة**. ظهورُه في أي عرضٍ لاحق
 * يجعل الوصول إلى الشاشة كافياً لانتحال الوكيل — والمخزَّن مُعمّى فلا
 * يُسترجَع أصلاً، فالشاشة هي المكان الوحيد الذي قد يُسرّبه.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SweaterIntegrationPage from '../SweaterIntegrationPage';

const NEW_KEY = {
  keyId: 'sk_testkey0001',
  secret: 'S3CR3T-shown-once-abcdefghijklmnop',
  fingerprint: 'ab12cd34ef56ab78',
  scope: 'integration_ingest',
};

const ACTIVE_KEY = {
  keyId: NEW_KEY.keyId, label: 'وكيل المتصفح', status: 'active',
  fingerprint: NEW_KEY.fingerprint, lastUsedAtIso: '2026-08-26T09:00:00Z',
};

const state = {
  canMutate: true,
  createKey: vi.fn(),
  revokeKey: vi.fn(),
  keys: [],
  current: { lastAgentStatus: 'ok', lastSuccessAtIso: new Date().toISOString(), source: 'browser_agent' },
};

vi.mock('../../contexts/PartnerViewContext', () => ({
  usePartnerView: () => ({ canMutate: state.canMutate, scalingFactor: 1 }),
}));

vi.mock('../../hooks/useSweater', () => ({
  useSweaterIntegration: () => ({
    current: state.current,
    runs: [],
    keys: state.keys,
    loading: false,
    error: null,
    keysError: null,
    refetch: vi.fn(),
    createKey: state.createKey,
    revokeKey: state.revokeKey,
  }),
  useSweaterConfig: () => ({ prices: [], adjustmentTypes: [], policy: [], loading: false, error: null }),
}));

beforeEach(() => {
  state.canMutate = true;
  state.keys = [];
  state.createKey = vi.fn().mockResolvedValue(NEW_KEY);
  state.revokeKey = vi.fn().mockResolvedValue({ status: 'revoked' });
  // المسبار لا يُجيب في jsdom — الصفحة تتجاهل فشله عمداً.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const createButton = () => screen.queryByRole('button', { name: /أنشئ مفتاحاً/ });
const dialog = () => screen.queryByRole('dialog');
const confirmIn = (d, name) => [...d.querySelectorAll('button')].find((b) => name.test(b.textContent));

describe('زر إنشاء المفتاح', () => {
  it('يظهر للمدير — الانحدار الأول', () => {
    render(<SweaterIntegrationPage />);
    expect(createButton()).toBeTruthy();
  });

  it('ويختفي لمن لا يملك التعديل', () => {
    state.canMutate = false;
    render(<SweaterIntegrationPage />);
    expect(createButton()).toBeNull();
  });

  it('والنقر يفتح نافذةً داخلية لا حواراً أصيلاً', () => {
    // الانحدار الثاني: `prompt` كان يوقف الوكيل هنا بالضبط.
    render(<SweaterIntegrationPage />);
    expect(dialog()).toBeNull();
    fireEvent.click(createButton());

    const d = dialog();
    expect(d).toBeTruthy();
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-label')).toMatch(/إنشاء مفتاح/);
  });

  it('وحقل الاسم يحمل الافتراض «الوكيل الرابع — Codex» ويُعنوَن بلافتة', () => {
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    // `getByLabelText` هو ما يستعمله الوكيل ليجد الحقل — لافتةٌ مربوطة لا زخرفة.
    const input = screen.getByLabelText(/اسم المفتاح/);
    expect(input.value).toBe('الوكيل الرابع — Codex');
  });
});

describe('الإلغاء آمن بكل طرقه', () => {
  const openDialog = () => {
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    return dialog();
  };

  it('«تراجع» يغلق ولا يستدعي شيئاً', () => {
    const d = openDialog();
    fireEvent.click(confirmIn(d, /تراجع/));
    expect(dialog()).toBeNull();
    expect(state.createKey).not.toHaveBeenCalled();
  });

  it('و✕ كذلك', () => {
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
    expect(dialog()).toBeNull();
    expect(state.createKey).not.toHaveBeenCalled();
  });

  it('ومفتاح الهروب كذلك', () => {
    openDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(state.createKey).not.toHaveBeenCalled();
  });

  it('والنقر خارجها كذلك', () => {
    openDialog();
    fireEvent.click(screen.getByTestId('sweater-dialog-backdrop'));
    expect(dialog()).toBeNull();
    expect(state.createKey).not.toHaveBeenCalled();
  });

  it('وإعادة الفتح بعد تعديلٍ ثم إلغاء تعود للافتراض — لا بقايا مرةٍ سابقة', () => {
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    fireEvent.change(screen.getByLabelText(/اسم المفتاح/), { target: { value: 'شيء آخر' } });
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(createButton());
    expect(screen.getByLabelText(/اسم المفتاح/).value).toBe('الوكيل الرابع — Codex');
  });
});

describe('التحقق قبل الإرسال', () => {
  it('اسمٌ فارغ يمنع الاستدعاء ويقول السبب', () => {
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    fireEvent.change(screen.getByLabelText(/اسم المفتاح/), { target: { value: '   ' } });
    fireEvent.click(confirmIn(dialog(), /أنشئ المفتاح/));

    expect(state.createKey).not.toHaveBeenCalled();
    expect(dialog()).toBeTruthy();
    expect(dialog().textContent).toMatch(/مطلوب/);
  });
});

describe('رحلة الإنشاء حتى استدعاء الخادم', () => {
  it('نقر ⇒ نافذة ⇒ اسم ⇒ تأكيد ⇒ `sweaterCreateIntegrationKey` بالاسم', async () => {
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    fireEvent.change(screen.getByLabelText(/اسم المفتاح/), { target: { value: 'الوكيل الرابع — Codex' } });
    fireEvent.click(confirmIn(dialog(), /أنشئ المفتاح/));

    await vi.waitFor(() => expect(state.createKey).toHaveBeenCalledTimes(1));
    expect(state.createKey).toHaveBeenCalledWith('الوكيل الرابع — Codex');
  });

  it('والاسم المُشذَّب هو ما يصل — لا فراغاته', async () => {
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    fireEvent.change(screen.getByLabelText(/اسم المفتاح/), { target: { value: '  وكيل الليل  ' } });
    fireEvent.click(confirmIn(dialog(), /أنشئ المفتاح/));

    await vi.waitFor(() => expect(state.createKey).toHaveBeenCalledWith('وكيل الليل'));
  });
});

describe('السرّ يُعرض مرة واحدة', () => {
  const create = async () => {
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    fireEvent.click(confirmIn(dialog(), /أنشئ المفتاح/));
    await screen.findByText(NEW_KEY.secret);
  };

  it('لا يظهر قبل الإنشاء', () => {
    render(<SweaterIntegrationPage />);
    expect(document.body.textContent).not.toContain(NEW_KEY.secret);
  });

  it('ويظهر بمعرّفه بعده، والنافذة تُغلق', async () => {
    await create();
    expect(document.body.textContent).toContain(NEW_KEY.keyId);
    expect(document.body.textContent).toMatch(/لن يُعرض مرة أخرى/);
    expect(dialog()).toBeNull();
  });

  it('ويُخفى بلا رجعة', async () => {
    await create();
    fireEvent.click(screen.getByRole('button', { name: /أخفِه/ }));
    expect(document.body.textContent).not.toContain(NEW_KEY.secret);
  });

  it('وقائمة المفاتيح لا تحمل سرّاً — البصمة وحدها', () => {
    state.keys = [ACTIVE_KEY];
    render(<SweaterIntegrationPage />);
    expect(document.body.textContent).toContain(NEW_KEY.keyId);
    expect(document.body.textContent).toContain(NEW_KEY.fingerprint.slice(-8));
    expect(document.body.textContent).not.toContain(NEW_KEY.secret);
  });

  it('ورفضُ الخادم يُعرض داخل النافذة وتبقى مفتوحةً بقيمها، ولا سرّ وهمي', async () => {
    state.createKey = vi.fn().mockRejectedValue(new Error('SWEATER_KEY_ENCRYPTION_KEY غير مضبوط'));
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    fireEvent.change(screen.getByLabelText(/اسم المفتاح/), { target: { value: 'وكيل الاختبار' } });
    fireEvent.click(confirmIn(dialog(), /أنشئ المفتاح/));

    await vi.waitFor(() => expect(dialog().textContent).toMatch(/SWEATER_KEY_ENCRYPTION_KEY/));
    // النافذة لم تُغلق، والقيمة لم تضع.
    expect(dialog()).toBeTruthy();
    expect(screen.getByLabelText(/اسم المفتاح/).value).toBe('وكيل الاختبار');
    expect(document.body.textContent).not.toContain(NEW_KEY.secret);
  });
});

describe('نافذة إلغاء المفتاح', () => {
  const openRevoke = () => {
    state.keys = [ACTIVE_KEY];
    render(<SweaterIntegrationPage />);
    fireEvent.click(screen.getByRole('button', { name: /ألغِ/ }));
    return dialog();
  };

  it('تعرض المعرّف والبصمة — ولا سرّ', () => {
    const d = openRevoke();
    expect(d.textContent).toContain(ACTIVE_KEY.keyId);
    expect(d.textContent).toContain(ACTIVE_KEY.fingerprint.slice(-8));
    expect(d.textContent).not.toContain(NEW_KEY.secret);
  });

  it('والسبب إلزامي — الإلغاء بلا سبب لا يمرّ', () => {
    const d = openRevoke();
    fireEvent.click(confirmIn(d, /ألغِ المفتاح/));
    expect(state.revokeKey).not.toHaveBeenCalled();
    expect(dialog().textContent).toMatch(/مطلوب/);
  });

  it('ومع السبب يصل المعرّف والسبب معاً', async () => {
    const d = openRevoke();
    fireEvent.change(screen.getByLabelText(/سبب الإلغاء/), { target: { value: 'تدوير دوري' } });
    fireEvent.click(confirmIn(d, /ألغِ المفتاح/));

    await vi.waitFor(() => expect(state.revokeKey).toHaveBeenCalledWith(ACTIVE_KEY.keyId, 'تدوير دوري'));
  });

  it('والمُلغى لا يحمل زر إلغاء أصلاً', () => {
    state.keys = [{ ...ACTIVE_KEY, status: 'revoked' }];
    render(<SweaterIntegrationPage />);
    expect(screen.queryByRole('button', { name: /ألغِ/ })).toBeNull();
  });
});
