// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// وثائق Firestore المزيّفة: المفتاح «المجموعة/المُعرّف».
const docs = new Map();
const denied = new Set();

vi.mock('../../lib/firebaseClient', () => ({
  db: {}, isFirebaseConfigured: true,
}));
vi.mock('../../lib/ledgerTransport', () => ({
  callServer: vi.fn(async () => ({ unclaimed: false })),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db, coll, id) => `${coll}/${id}`,
  getDoc: async (path) => {
    if (denied.has(path)) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    const data = docs.get(path);
    return { exists: () => Boolean(data), data: () => data };
  },
}));

const { useMembership } = await import('../useMembership');

function Probe({ uid }) {
  const m = useMembership(uid);
  return <span data-testid="role">{m.loading ? '…' : String(m.role)}</span>;
}

const roleAfter = async (uid) => {
  render(<Probe uid={uid} />);
  await waitFor(() => expect(screen.getByTestId('role').textContent).not.toBe('…'));
  return screen.getByTestId('role').textContent;
};

afterEach(() => { cleanup(); docs.clear(); denied.clear(); });

describe('حزام الإدارة: app_admins', () => {
  it('وثيقة app_admins تعني «مدير» ولو قال حقل الدور غير ذلك', async () => {
    // الواقعة: مالكٌ حقل دوره partner ووثيقته في app_admins. القواعد تمنحه
    // كل شيء (firestore.rules:52) وكانت الشاشة تقفله.
    docs.set('users/u1', { role: 'partner' });
    docs.set('app_admins/u1', { note: 'console' });
    expect(await roleAfter('u1')).toBe('admin');
  });

  it('وتعني «مدير» حتى بلا وثيقة users أصلاً', async () => {
    docs.set('app_admins/u2', {});
    expect(await roleAfter('u2')).toBe('admin');
  });

  it('رفضُ قراءة app_admins يُقرأ «ليس مديراً» لا عطلاً', async () => {
    // غير المدير يُرفض بـ permission-denied — وهو الجواب لا خطأ.
    docs.set('users/u3', { role: 'partner' });
    denied.add('app_admins/u3');
    expect(await roleAfter('u3')).toBe('partner');
  });

  it('الدور الصريح يبقى كما هو حين لا حزام', async () => {
    docs.set('users/u4', { role: 'admin' });
    expect(await roleAfter('u4')).toBe('admin');
    cleanup();
    docs.set('users/u5', { role: 'partner' });
    denied.add('app_admins/u5');
    expect(await roleAfter('u5')).toBe('partner');
  });

  it('وثيقة بلا حقل دور تبقى operator كما تفترض القواعد', async () => {
    docs.set('users/u6', { email: 'x@y.com' });
    denied.add('app_admins/u6');
    expect(await roleAfter('u6')).toBe('operator');
  });

  it('لا وثيقة ولا حزام: ليس عضواً', async () => {
    denied.add('app_admins/u7');
    expect(await roleAfter('u7')).toBe('null');
  });
});
