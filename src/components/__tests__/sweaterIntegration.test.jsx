// @vitest-environment jsdom
/**
 * بوابة تكامل سويتر — الزرّ يظهر، والسرّ يُعرض مرة واحدة
 * ═══════════════════════════════════════════════════════════════════════════
 * انحدارٌ حقيقي وقع: `actions` بدل `action` على `SectionHeader` أخفت زر
 * «أنشئ مفتاحاً» **حتى عن المدير**، فبقيت البوابة على صفر مفاتيح والتكامل
 * كله معطّلاً — بلا خطأ ولا تحذير، لأن React يُسقط الخاصية المجهولة بصمت.
 *
 * والادعاء الحامل هنا ليس «الزر موجود في الشيفرة» بل **«الزر يُرسَم فعلاً
 * ونقرُه يصل الخادم»**: اختبارٌ يقرأ المصدر كان سيمرّ على العطب نفسه.
 *
 * والادعاء الثاني: **السرّ يُعرض مرة واحدة**. ظهورُه في أي عرضٍ لاحق يجعل
 * الوصول إلى الشاشة كافياً لانتحال الوكيل — والمخزَّن مُعمّى فلا يُسترجَع
 * أصلاً، فالشاشة هي المكان الوحيد الذي قد يُسرّبه.
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

const CREATE_LABEL = /أنشئ مفتاحاً/;

beforeEach(() => {
  state.canMutate = true;
  state.keys = [];
  state.createKey = vi.fn().mockResolvedValue(NEW_KEY);
  state.revokeKey = vi.fn();
  vi.spyOn(window, 'prompt').mockReturnValue('وكيل المتصفح');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const createButton = () => screen.queryByRole('button', { name: CREATE_LABEL });

describe('بوابة تكامل سويتر — زر إنشاء المفتاح', () => {
  it('يظهر للمدير — الادعاء الذي سقط بصمت', () => {
    render(<SweaterIntegrationPage />);
    expect(createButton()).toBeTruthy();
  });

  it('ويختفي لمن لا يملك التعديل', () => {
    state.canMutate = false;
    render(<SweaterIntegrationPage />);
    expect(createButton()).toBeNull();
  });

  it('والنقر يستدعي إنشاء المفتاح على الخادم', async () => {
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    await vi.waitFor(() => expect(state.createKey).toHaveBeenCalledTimes(1));
    expect(state.createKey).toHaveBeenCalledWith('وكيل المتصفح');
  });

  it('وإلغاء نافذة الاسم لا يستدعي شيئاً', () => {
    window.prompt.mockReturnValue(null);
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    expect(state.createKey).not.toHaveBeenCalled();
  });
});

describe('السرّ يُعرض مرة واحدة', () => {
  it('لا يظهر قبل الإنشاء', () => {
    render(<SweaterIntegrationPage />);
    expect(document.body.textContent).not.toContain(NEW_KEY.secret);
  });

  it('ويظهر بمعرّفه بعده', async () => {
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    await screen.findByText(NEW_KEY.secret);
    expect(document.body.textContent).toContain(NEW_KEY.keyId);
    expect(document.body.textContent).toMatch(/لن يُعرض مرة أخرى/);
  });

  it('ويُخفى بلا رجعة عند الإخفاء', async () => {
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());
    await screen.findByText(NEW_KEY.secret);

    fireEvent.click(screen.getByRole('button', { name: /أخفِه/ }));
    expect(document.body.textContent).not.toContain(NEW_KEY.secret);
  });

  it('وقائمة المفاتيح لا تحمل سرّاً — البصمة وحدها', () => {
    // الادعاء الأمني: المخزَّن مُعمّى ولا يُسترجَع، فالقائمة لا تعرضه أبداً.
    state.keys = [{
      keyId: NEW_KEY.keyId, label: 'وكيل المتصفح', status: 'active',
      fingerprint: NEW_KEY.fingerprint, lastUsedAtIso: null, scope: 'integration_ingest',
    }];
    render(<SweaterIntegrationPage />);
    expect(document.body.textContent).toContain(NEW_KEY.keyId);
    expect(document.body.textContent).toContain(NEW_KEY.fingerprint.slice(-8));
    expect(document.body.textContent).not.toContain(NEW_KEY.secret);
  });

  it('ورفضُ الخادم يُعرض ولا يُعرَض سرٌّ وهمي', async () => {
    state.createKey = vi.fn().mockRejectedValue(new Error('SWEATER_KEY_ENCRYPTION_KEY غير مضبوط'));
    render(<SweaterIntegrationPage />);
    fireEvent.click(createButton());

    await vi.waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getAllByRole('alert')[0].textContent).toContain('SWEATER_KEY_ENCRYPTION_KEY');
    expect(document.body.textContent).not.toContain(NEW_KEY.secret);
  });
});

describe('المفتاح الفعّال يظهر في القائمة', () => {
  it('بحالته وبصمته، ومعه زر الإلغاء للمدير', () => {
    state.keys = [{
      keyId: NEW_KEY.keyId, label: 'وكيل المتصفح', status: 'active',
      fingerprint: NEW_KEY.fingerprint, lastUsedAtIso: '2026-08-26T09:00:00Z',
    }];
    render(<SweaterIntegrationPage />);
    expect(document.body.textContent).toContain('فعّال');
    expect(screen.getByRole('button', { name: /ألغِ/ })).toBeTruthy();
  });

  it('والمُلغى لا يحمل زر إلغاء', () => {
    state.keys = [{ keyId: 'sk_old', label: 'قديم', status: 'revoked', fingerprint: 'ffffffffffffffff' }];
    render(<SweaterIntegrationPage />);
    expect(document.body.textContent).toContain('مُلغى');
    expect(screen.queryByRole('button', { name: /ألغِ/ })).toBeNull();
  });
});
