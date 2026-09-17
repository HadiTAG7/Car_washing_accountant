import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, {
  applyCustomLinkHost, createPasswordResetHandler, generateLink,
} from '../../api/password-reset.js';
import { PasswordResetEmailError } from '../../server/passwordResetEmail.js';
import { PasswordResetConfigError } from '../../server/passwordResetRuntime.js';

const LINK = 'https://gemini-eed4a.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=abc';

const MAILER_ENV = {
  PASSWORD_RESET_EMAIL_PROVIDER: 'resend',
  PASSWORD_RESET_EMAIL_API_KEY: 'test-key',
  PASSWORD_RESET_EMAIL_FROM: 'no-reply@sweater.test',
};

function request({ method = 'POST', body = { email: 'user@example.com' }, headers = {}, stream = false } = {}) {
  if (!stream) return { method, headers, body };
  const readable = Readable.from([Buffer.from(JSON.stringify(body))]);
  readable.method = method;
  readable.headers = headers;
  return readable;
}

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

/** بيئة صالحة كاملة، مع بدائل قابلة للحقن لكل طرف خارجي. */
function deps(overrides = {}) {
  const generatePasswordResetLink = overrides.generatePasswordResetLink
    ?? vi.fn(async () => LINK);
  const send = overrides.send ?? vi.fn(async () => ({ ok: true }));
  const consumeQuota = overrides.consumeQuota ?? vi.fn(async () => ({ allowed: true, reason: 'ok' }));
  const runtimeFactory = overrides.runtimeFactory ?? vi.fn(() => ({
    auth: { generatePasswordResetLink }, db: {}, FieldValue: {},
  }));
  return {
    generatePasswordResetLink, send, consumeQuota, runtimeFactory,
    endpoint: createPasswordResetHandler({ runtimeFactory, send, consumeQuota, ...overrides.handler }),
  };
}

function withMailerEnv() {
  Object.assign(process.env, MAILER_ENV);
}

afterEach(() => {
  for (const key of Object.keys(MAILER_ENV)) delete process.env[key];
  delete process.env.PASSWORD_RESET_APP_URL;
  delete process.env.PASSWORD_RESET_LINK_HOST;
  vi.restoreAllMocks();
});

describe('applyCustomLinkHost', () => {
  it('rewrites only the default Firebase host', () => {
    expect(applyCustomLinkHost(LINK, 'auth.sweater.test'))
      .toContain('https://auth.sweater.test/__/auth/action');
  });

  it('leaves an already-custom link alone, scheme and path included', () => {
    const custom = 'https://auth.sweater.test/__/auth/action?oobCode=abc';
    expect(applyCustomLinkHost(custom, 'other.sweater.test')).toBe(custom);
  });

  it('is a no-op without the variable, and on an unparseable link', () => {
    expect(applyCustomLinkHost(LINK, '')).toBe(LINK);
    expect(applyCustomLinkHost(LINK, '   ')).toBe(LINK);
    expect(applyCustomLinkHost('not-a-url', 'auth.sweater.test')).toBe('not-a-url');
  });

  it('accepts the host written with a scheme or a trailing slash', () => {
    expect(applyCustomLinkHost(LINK, 'https://auth.sweater.test/'))
      .toContain('https://auth.sweater.test/');
  });
});

describe('generateLink', () => {
  const APP = 'https://app.sweater.test/';

  function authThatRejectsContinueUri(code) {
    const generatePasswordResetLink = vi.fn(async (email, settings) => {
      if (settings) throw Object.assign(new Error('rejected'), { code });
      return LINK;
    });
    return { auth: { generatePasswordResetLink }, generatePasswordResetLink };
  }

  it('asks for the continue URL when one is configured', async () => {
    const generatePasswordResetLink = vi.fn(async () => LINK);
    await generateLink({ generatePasswordResetLink }, 'u@e.test', APP);
    expect(generatePasswordResetLink)
      .toHaveBeenCalledWith('u@e.test', { url: APP, handleCodeInApp: false });
  });

  it('omits the settings object entirely when none is configured', async () => {
    const generatePasswordResetLink = vi.fn(async () => LINK);
    await generateLink({ generatePasswordResetLink }, 'u@e.test', '');
    expect(generatePasswordResetLink).toHaveBeenCalledWith('u@e.test');
  });

  for (const code of [
    'auth/unauthorized-continue-uri', 'auth/invalid-continue-uri', 'auth/missing-continue-uri',
  ]) {
    it(`drops the continue URL rather than the user on ${code}`, async () => {
      // الزينة تسقط قبل أن يسقط المسار الوحيد الذي يستعيد الحساب.
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { auth, generatePasswordResetLink } = authThatRejectsContinueUri(code);
      await expect(generateLink(auth, 'u@e.test', APP)).resolves.toBe(LINK);
      expect(generatePasswordResetLink).toHaveBeenCalledTimes(2);
      expect(generatePasswordResetLink).toHaveBeenLastCalledWith('u@e.test');
    });
  }

  it('does not retry, and does not swallow, any other failure', async () => {
    const generatePasswordResetLink = vi.fn(async () => {
      throw Object.assign(new Error('nope'), { code: 'auth/user-not-found' });
    });
    await expect(generateLink({ generatePasswordResetLink }, 'u@e.test', APP))
      .rejects.toMatchObject({ code: 'auth/user-not-found' });
    expect(generatePasswordResetLink).toHaveBeenCalledTimes(1);
  });
});

describe('/api/password-reset', () => {
  it('exports a production handler and accepts POST only', async () => {
    const res = response();
    await handler(request({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('answers 501 when no mail provider is configured, so the UI can fall back', async () => {
    // غياب الضبط ليس عطلاً: رسالةٌ في السبام أفضل من لا رسالة.
    const { endpoint, runtimeFactory } = deps();
    const res = response();
    await endpoint(request(), res);
    expect(res.statusCode).toBe(501);
    expect(res.body).toEqual({ ok: false, error: 'not-configured' });
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('refuses a malformed address before opening Firestore', async () => {
    withMailerEnv();
    const { endpoint, runtimeFactory } = deps();
    const res = response();
    await endpoint(request({ body: { email: 'not-an-email' } }), res);
    expect(res.statusCode).toBe(400);
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('sends the branded message and confirms without echoing the address', async () => {
    withMailerEnv();
    const { endpoint, send, generatePasswordResetLink } = deps();
    const res = response();
    await endpoint(request({ body: { email: ' User@Example.COM ' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(generatePasswordResetLink).toHaveBeenCalledWith('user@example.com');
    const [config, message] = send.mock.calls[0];
    expect(config.provider).toBe('resend');
    expect(message.to).toBe('user@example.com');
    expect(message.html).toContain('dir="rtl"');
    expect(message.text).toContain(LINK);
  });

  it('reads the body from a stream when the host did not parse it', async () => {
    withMailerEnv();
    const { endpoint, send } = deps();
    const res = response();
    await endpoint(request({ stream: true }), res);
    expect(res.statusCode).toBe(200);
    expect(send).toHaveBeenCalled();
  });

  it('takes the continue URL from the server, never from the request body', async () => {
    // قيمةٌ من المتصفّح تعني إعادة توجيه مفتوحة داخل رسالة يثق بها المستخدم.
    withMailerEnv();
    process.env.PASSWORD_RESET_APP_URL = 'https://app.sweater.test/';
    const { endpoint, generatePasswordResetLink } = deps();
    const res = response();
    await endpoint(request({ body: { email: 'user@example.com', url: 'https://evil.test' } }), res);

    expect(generatePasswordResetLink).toHaveBeenCalledWith(
      'user@example.com', { url: 'https://app.sweater.test/', handleCodeInApp: false },
    );
  });

  it('applies the custom action host to the generated link', async () => {
    withMailerEnv();
    process.env.PASSWORD_RESET_LINK_HOST = 'auth.sweater.test';
    const { endpoint, send } = deps();
    const res = response();
    await endpoint(request(), res);
    expect(send.mock.calls[0][1].text).toContain('https://auth.sweater.test/__/auth/action');
  });

  it('answers an unknown account exactly as a known one, and sends nothing', async () => {
    // الجواب المختلف يحوّل نموذج الاسترجاع إلى أداة تعداد حسابات.
    withMailerEnv();
    const notFound = Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
    const { endpoint, send } = deps({
      generatePasswordResetLink: vi.fn(async () => { throw notFound; }),
    });
    const res = response();
    await endpoint(request({ body: { email: 'ghost@example.com' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses past the rate limit without sending', async () => {
    withMailerEnv();
    const { endpoint, send } = deps({
      consumeQuota: vi.fn(async () => ({ allowed: false, reason: 'email-cooldown' })),
    });
    const res = response();
    await endpoint(request(), res);

    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe('rate-limited');
    expect(send).not.toHaveBeenCalled();
  });

  it('counts the quota against both the address and the source IP', async () => {
    withMailerEnv();
    const { endpoint, consumeQuota } = deps();
    const res = response();
    await endpoint(request({ headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' } }), res);
    expect(consumeQuota.mock.calls[0][2]).toMatchObject({
      email: 'user@example.com', ip: '198.51.100.9',
    });
  });

  it('still delivers when the app URL is not an authorized Firebase domain', async () => {
    // هذا هو العطل الذي ظهر في الإنتاج: رفضُ رابط العودة كان يُسقط الطلب كلّه.
    withMailerEnv();
    process.env.PASSWORD_RESET_APP_URL = 'https://new-deploy.test/';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const generatePasswordResetLink = vi.fn(async (email, settings) => {
      if (settings) throw Object.assign(new Error('x'), { code: 'auth/unauthorized-continue-uri' });
      return LINK;
    });
    const { endpoint, send } = deps({ generatePasswordResetLink });
    const res = response();
    await endpoint(request(), res);

    expect(res.statusCode).toBe(200);
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[0][1].text).toContain(LINK);
  });

  it('reports a provider failure as 502 so the UI falls back to Firebase', async () => {
    withMailerEnv();
    const { endpoint } = deps({
      send: vi.fn(async () => {
        throw new PasswordResetEmailError('رفض', { code: 'provider-rejected', httpStatus: 502 });
      }),
    });
    const res = response();
    await endpoint(request(), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('provider-rejected');
  });

  it('hides an unexpected failure behind an incident id', async () => {
    withMailerEnv();
    const { endpoint } = deps({
      runtimeFactory: vi.fn(() => { throw new Error('unexpected-internal-detail'); }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = response();
    await endpoint(request(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('internal');
    expect(res.body.incidentId).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(res.body)).not.toContain('unexpected-internal-detail');
  });

  it('names the missing variable on a configuration fault instead of hiding it', async () => {
    // «خطأ داخلي» أرسل التشخيص إلى الكود بينما العطل متغيّر بيئة ناقص —
    // ومَن يضبط المتغيّرات لا يملك بالضرورة سجلات المستضيف ليقرأ رقم بلاغ.
    withMailerEnv();
    const { endpoint } = deps({
      runtimeFactory: vi.fn(() => {
        throw new PasswordResetConfigError('FIREBASE_SERVICE_ACCOUNT غير مضبوط.');
      }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = response();
    await endpoint(request(), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('configuration');
    expect(res.body.message).toContain('FIREBASE_SERVICE_ACCOUNT');
  });

  it('reports which step failed, so the fault is placed without host logs', async () => {
    withMailerEnv();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const atQuota = deps({ consumeQuota: vi.fn(async () => { throw new Error('boom'); }) });
    const res1 = response();
    await atQuota.endpoint(request(), res1);
    expect(res1.body).toMatchObject({ stage: 'quota' });

    const atLink = deps({
      generatePasswordResetLink: vi.fn(async () => { throw new Error('boom'); }),
    });
    const res2 = response();
    await atLink.endpoint(request(), res2);
    expect(res2.body).toMatchObject({ stage: 'link' });

    const atRuntime = deps({ runtimeFactory: vi.fn(() => { throw new Error('boom'); }) });
    const res3 = response();
    await atRuntime.endpoint(request(), res3);
    expect(res3.body).toMatchObject({ stage: 'runtime' });
  });

  it('keeps the stage out of a provider failure, which already names itself', async () => {
    withMailerEnv();
    const { endpoint } = deps({
      send: vi.fn(async () => {
        throw new PasswordResetEmailError('رفض', { code: 'provider-rejected' });
      }),
    });
    const res = response();
    await endpoint(request(), res);
    expect(res.body.error).toBe('provider-rejected');
  });

  it('refuses an unsupported provider as misconfiguration, not as a caller error', async () => {
    withMailerEnv();
    process.env.PASSWORD_RESET_EMAIL_PROVIDER = 'carrier-pigeon';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { endpoint, runtimeFactory } = deps();
    const res = response();
    await endpoint(request(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('provider-unsupported');
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('never writes the API key into a log line', async () => {
    withMailerEnv();
    const lines = [];
    vi.spyOn(console, 'info').mockImplementation((line) => lines.push(line));
    const { endpoint } = deps();
    const res = response();
    await endpoint(request(), res);
    expect(res.statusCode).toBe(200);
    expect(lines.join('\n')).not.toContain('test-key');
    expect(lines.join('\n')).not.toContain('user@example.com');
  });
});
