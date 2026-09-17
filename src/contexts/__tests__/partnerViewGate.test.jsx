// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authState = { user: null };
const partnersState = { partners: [] };

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../../hooks/usePartners', () => ({ usePartners: () => partnersState }));

const { PartnerViewProvider, usePartnerView } = await import('../PartnerViewContext');

const P1 = { id: 'p1', partnerName: 'أحمد', workersCount: 3, userId: 'uidAhmed' };
const P2 = { id: 'p2', partnerName: 'خالد', workersCount: 7, userId: 'uidKhaled' };

/** يطبع قرارات البوابة كي تُقرأ من الـ DOM بلا تخمين. */
function Probe() {
  const v = usePartnerView();
  return (
    <ul>
      <li data-testid="isAdmin">{String(v.isAdmin)}</li>
      <li data-testid="canMutate">{String(v.canMutate)}</li>
      <li data-testid="isPartnerView">{String(v.isPartnerView)}</li>
      <li data-testid="linkMissing">{String(v.investorLinkMissing)}</li>
      <li data-testid="scale">{String(v.scalingFactor)}</li>
      <li data-testid="viewed">{v.viewedPartner?.id ?? 'none'}</li>
    </ul>
  );
}

function mount({ user = null, partners = [], role = null } = {}) {
  authState.user = user;
  partnersState.partners = partners;
  return render(
    <PartnerViewProvider role={role}><Probe /></PartnerViewProvider>,
  );
}

const read = (id) => screen.getByTestId(id).textContent;

afterEach(() => {
  cleanup();
  try { window.localStorage.clear(); } catch { /* private mode */ }
});

describe('بوابة عرض الشريك', () => {
  it('المدير: يكتب ويرى أرقام الشركة كاملة', () => {
    mount({ user: { id: 'uidBoss' }, partners: [P1, P2], role: 'admin' });
    expect(read('isAdmin')).toBe('true');
    expect(read('canMutate')).toBe('true');
    expect(read('isPartnerView')).toBe('false');
    expect(read('scale')).toBe('1');
  });

  it('مستثمر مربوط: لا يكتب، وأرقامه بحصّته', () => {
    mount({ user: { id: 'uidAhmed' }, partners: [P1, P2], role: 'partner' });
    expect(read('isAdmin')).toBe('false');
    expect(read('canMutate')).toBe('false');
    expect(read('isPartnerView')).toBe('true');
    expect(read('viewed')).toBe('p1');
    expect(read('scale')).toBe(String(3 / 10));
  });

  it('مستثمر بلا ربط: مسدود لا مدير — وهذا هو العطل الذي كان', () => {
    // قبل الإصلاح: `isAdmin` من غياب الصفّ وحده، فكان هذا الحساب يحصل على
    // الواجهة الإدارية كاملة بأرقام الشركة غير مقسومة.
    mount({ user: { id: 'uidGhost' }, partners: [P1, P2], role: 'partner' });
    expect(read('isAdmin')).toBe('false');
    expect(read('canMutate')).toBe('false');
    expect(read('linkMissing')).toBe('true');
    expect(read('isPartnerView')).toBe('true');
    expect(read('scale')).toBe('0');   // لا واحداً صحيحاً: لا نعرف حصّته
  });

  it('صفٌّ بمُعرّف لا يطابق حساب الداخل لا يمنح الوصول', () => {
    mount({ user: { id: 'uidSomeoneElse' }, partners: [P1], role: 'partner' });
    expect(read('linkMissing')).toBe('true');
    expect(read('viewed')).toBe('none');
  });

  it('مُعرّف Firebase حسّاس لحالة الأحرف: اختلافها ليس تطابقاً', () => {
    mount({ user: { id: 'UIDAHMED' }, partners: [P1], role: 'partner' });
    expect(read('linkMissing')).toBe('true');
  });

  it('محاكاة المدير: يفقد الكتابة ويأخذ حصّة المُحاكى', () => {
    window.localStorage.setItem('sweater:actingAsPartnerId', 'p2');
    mount({ user: { id: 'uidBoss' }, partners: [P1, P2], role: 'admin' });
    expect(read('canMutate')).toBe('false');
    expect(read('isPartnerView')).toBe('true');
    expect(read('viewed')).toBe('p2');
    expect(read('scale')).toBe(String(7 / 10));
  });

  it('محاكاة لشريك حُذف تعود إلى المسار الإداري بلا احتجاز', () => {
    window.localStorage.setItem('sweater:actingAsPartnerId', 'deleted');
    mount({ user: { id: 'uidBoss' }, partners: [P1], role: 'admin' });
    expect(read('isPartnerView')).toBe('false');
    expect(read('scale')).toBe('1');
  });

  it('وضع العرض التجريبي (بلا دور) يبقى كما كان', () => {
    // `role: null` هو حال العرض التجريبي وغياب Firebase — لا يُعامل كمستثمر.
    mount({ user: { id: 'uidDemo' }, partners: [], role: null });
    expect(read('isAdmin')).toBe('true');
    expect(read('canMutate')).toBe('true');
  });

  it('عمالة صفر لا تقسم على صفر', () => {
    const zero = { id: 'p9', partnerName: 'سالم', workersCount: 0, userId: 'uidSalem' };
    mount({ user: { id: 'uidSalem' }, partners: [zero], role: 'partner' });
    expect(read('scale')).toBe('1');   // totalWorkers = 0 → الحارس القائم
    expect(read('canMutate')).toBe('false');
  });
});
