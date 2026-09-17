import { afterEach, describe, expect, it, vi } from 'vitest';

const sendPasswordResetEmail = vi.fn(async () => {});
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }));

const {
  PASSWORD_RESET_ENDPOINT, PasswordResetRateLimited, requestPasswordReset,
} = await import('../passwordReset.js');

const AUTH = { app: 'fake' };
const EMAIL = 'user@example.com';

const ok = () => vi.fn(async () => ({ ok: true, status: 200 }));
const status = (code) => vi.fn(async () => ({ ok: false, status: code }));

afterEach(() => {
  sendPasswordResetEmail.mockClear();
  sendPasswordResetEmail.mockImplementation(async () => {});
});

describe('requestPasswordReset', () => {
  it('prefers the server path and does not touch Firebase when it succeeds', async () => {
    const fetchImpl = ok();
    expect(await requestPasswordReset(AUTH, EMAIL, { fetchImpl })).toEqual({ via: 'server' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(PASSWORD_RESET_ENDPOINT);
    expect(JSON.parse(init.body)).toEqual({ email: EMAIL });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('trims the address before sending it anywhere', async () => {
    const fetchImpl = ok();
    await requestPasswordReset(AUTH, `  ${EMAIL}  `, { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ email: EMAIL });
  });

  it('refuses an empty address without a request', async () => {
    const fetchImpl = ok();
    await expect(requestPasswordReset(AUTH, '   ', { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  for (const [label, code] of [
    ['no provider configured', 501],
    ['endpoint not deployed', 404],
    ['method not allowed', 405],
    ['provider rejected the message', 502],
    ['server fault', 500],
  ]) {
    it(`falls back to Firebase when the server answers ${code} (${label})`, async () => {
      // قطع الاسترجاع يقفل المستخدم خارج حسابه — رسالةٌ في السبام أفضل من لا رسالة.
      expect(await requestPasswordReset(AUTH, EMAIL, { fetchImpl: status(code) }))
        .toEqual({ via: 'firebase' });
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(AUTH, EMAIL, undefined);
    });
  }

  it('falls back when the network drops the request entirely', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await requestPasswordReset(AUTH, EMAIL, { fetchImpl })).toEqual({ via: 'firebase' });
    expect(sendPasswordResetEmail).toHaveBeenCalled();
  });

  it('surfaces the rate limit instead of quietly re-sending through Firebase', async () => {
    // العودة إلى Firebase هنا تلتفّ على الحدّ الذي وُضع لحماية صندوق البريد.
    await expect(requestPasswordReset(AUTH, EMAIL, { fetchImpl: status(429) }))
      .rejects.toBeInstanceOf(PasswordResetRateLimited);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('passes the continue URL on the fallback path', async () => {
    await requestPasswordReset(AUTH, EMAIL, {
      fetchImpl: status(501), origin: 'https://app.sweater.test/',
    });
    expect(sendPasswordResetEmail)
      .toHaveBeenCalledWith(AUTH, EMAIL, { url: 'https://app.sweater.test/' });
  });

  it('retries without the continue URL when the origin is not an authorized domain', async () => {
    // بلا هذه المحاولة الثانية يفشل المسار الوحيد الذي يستعيد الحساب.
    sendPasswordResetEmail.mockImplementationOnce(async () => {
      throw Object.assign(new Error('unauthorized'), { code: 'auth/unauthorized-continue-uri' });
    });
    expect(await requestPasswordReset(AUTH, EMAIL, {
      fetchImpl: status(501), origin: 'https://new-deploy.test/',
    })).toEqual({ via: 'firebase' });

    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2);
    expect(sendPasswordResetEmail).toHaveBeenLastCalledWith(AUTH, EMAIL);
  });

  it('propagates any other Firebase error rather than reporting success', async () => {
    sendPasswordResetEmail.mockImplementation(async () => {
      throw Object.assign(new Error('too many'), { code: 'auth/too-many-requests' });
    });
    await expect(requestPasswordReset(AUTH, EMAIL, { fetchImpl: status(501) }))
      .rejects.toThrow('too many');
  });

  it('goes straight to Firebase where fetch does not exist', async () => {
    expect(await requestPasswordReset(AUTH, EMAIL, { fetchImpl: null })).toEqual({ via: 'firebase' });
    expect(sendPasswordResetEmail).toHaveBeenCalled();
  });
});
