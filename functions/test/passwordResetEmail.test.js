import { describe, expect, it, vi } from 'vitest';
import {
  PasswordResetEmailError,
  deliverPasswordResetEmail,
  escapeHtml,
  normalizeEmail,
  readMailerConfig,
  renderPasswordResetEmail,
} from '../../server/passwordResetEmail.js';

const LINK = 'https://gemini-eed4a.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=abc';

const ENV = {
  PASSWORD_RESET_EMAIL_PROVIDER: 'resend',
  PASSWORD_RESET_EMAIL_API_KEY: 'test-key',
  PASSWORD_RESET_EMAIL_FROM: 'no-reply@sweater.test',
};

function okFetch() {
  return vi.fn(async () => ({ ok: true, status: 200 }));
}

describe('normalizeEmail', () => {
  it('trims, lowercases and accepts a plain address', () => {
    expect(normalizeEmail('  Haditag77+Admin@Gmail.com ')).toBe('haditag77+admin@gmail.com');
  });

  it('accepts a sub-domain address, which company mail routinely uses', () => {
    // رفضها يقفل صاحبها خارج حسابه: المسار الوحيد للاسترجاع يمرّ من هنا.
    expect(normalizeEmail('user@mail.company.com')).toBe('user@mail.company.com');
    expect(normalizeEmail('admin@sub.domain.co.uk')).toBe('admin@sub.domain.co.uk');
  });

  it('rejects what cannot be an address', () => {
    for (const bad of ['', '   ', 'no-at-sign', 'a@b', 'a@b.c', 'two@@at.com', 'a b@c.com',
      'header@inject.com\nBcc: x@y.com', `${'a'.repeat(250)}@b.com`]) {
      expect(normalizeEmail(bad)).toBe('');
    }
  });
});

describe('readMailerConfig', () => {
  it('reports "not configured" rather than throwing when nothing is set', () => {
    // الصمت هنا متعمّد: الواجهة تعود إلى مسار Firebase بدل أن تفشل.
    expect(readMailerConfig({}).enabled).toBe(false);
  });

  it('refuses a partial configuration instead of half-sending', () => {
    expect(() => readMailerConfig({ PASSWORD_RESET_EMAIL_PROVIDER: 'carrier-pigeon' }))
      .toThrow(PasswordResetEmailError);
    expect(() => readMailerConfig({ PASSWORD_RESET_EMAIL_PROVIDER: 'resend' }))
      .toThrow(/API_KEY/);
    expect(() => readMailerConfig({ ...ENV, PASSWORD_RESET_EMAIL_FROM: 'not-an-email' }))
      .toThrow(/FROM/);
  });

  it('defaults the sender name, because an unnamed sender is half the spam problem', () => {
    const config = readMailerConfig(ENV);
    expect(config.enabled).toBe(true);
    expect(config.fromName).toBe('سويتر — Sweater');
    expect(config.replyTo).toBe('');
  });

  it('derives the Mailgun domain from the sender when not given', () => {
    const config = readMailerConfig({
      ...ENV, PASSWORD_RESET_EMAIL_PROVIDER: 'mailgun',
    });
    expect(config.mailgunDomain).toBe('sweater.test');
    expect(config.mailgunRegion).toBe('us');
  });
});

describe('renderPasswordResetEmail', () => {
  it('ships a text alternative alongside the HTML', () => {
    // رسالة HTML وحدها ترفع درجة السبام — البديل النصي ليس ترفاً.
    const { subject, html, text } = renderPasswordResetEmail({ link: LINK });
    expect(subject).toContain('سويتر');
    expect(text).toContain(LINK);
    expect(text.length).toBeGreaterThan(200);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('ساعة واحدة');
    expect(text).toContain('ساعة واحدة');
  });

  it('shows the link as readable text, not only behind a button', () => {
    const { html } = renderPasswordResetEmail({ link: LINK });
    const occurrences = html.split(LINK.replaceAll('&', '&amp;')).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3); // href الزر + href النص + النص نفسه
  });

  it('carries no external image or tracking pixel', () => {
    const { html } = renderPasswordResetEmail({ link: LINK });
    expect(html).not.toMatch(/<img/i);
  });

  it('escapes the link instead of letting it close an attribute', () => {
    const hostile = 'https://evil.test/"><script>alert(1)</script>';
    const { html } = renderPasswordResetEmail({ link: hostile });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('refuses a non-https link', () => {
    for (const bad of ['', 'http://x.test/a', 'javascript:alert(1)']) {
      expect(() => renderPasswordResetEmail({ link: bad })).toThrow(PasswordResetEmailError);
    }
  });

  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml(`<&">'`)).toBe('&lt;&amp;&quot;&gt;&#39;');
  });
});

describe('deliverPasswordResetEmail', () => {
  const message = { to: 'user@example.com', subject: 's', html: '<p>h</p>', text: 't' };

  it('posts both content parts to Resend with the reply-to', async () => {
    const fetchImpl = okFetch();
    const config = readMailerConfig({ ...ENV, PASSWORD_RESET_EMAIL_REPLY_TO: 'support@sweater.test' });
    await deliverPasswordResetEmail(config, message, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(init.body);
    expect(body.text).toBe('t');
    expect(body.html).toBe('<p>h</p>');
    expect(body.reply_to).toBe('support@sweater.test');
    expect(init.headers.Authorization).toBe('Bearer test-key');
  });

  it('disables click tracking on SendGrid so the link keeps our domain', async () => {
    // المقتفي يعيد كتابة الرابط إلى نطاق المزوّد المشترك — وهو عين ما نهرب منه.
    const fetchImpl = okFetch();
    const config = readMailerConfig({ ...ENV, PASSWORD_RESET_EMAIL_PROVIDER: 'sendgrid' });
    await deliverPasswordResetEmail(config, message, { fetchImpl });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.tracking_settings.click_tracking.enable).toBe(false);
    expect(body.content[0].type).toBe('text/plain'); // الترتيب مُلزِم لدى SendGrid
    expect(body.content[1].type).toBe('text/html');
  });

  it('disables tracking on Mailgun and targets the right region', async () => {
    const fetchImpl = okFetch();
    const config = readMailerConfig({
      ...ENV,
      PASSWORD_RESET_EMAIL_PROVIDER: 'mailgun',
      PASSWORD_RESET_EMAIL_MAILGUN_REGION: 'EU',
    });
    await deliverPasswordResetEmail(config, message, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.eu.mailgun.net/v3/sweater.test/messages');
    const form = new URLSearchParams(init.body);
    expect(form.get('o:tracking-clicks')).toBe('no');
    expect(form.get('html')).toBe('<p>h</p>');
  });

  it('rejects an invalid recipient before touching the network', async () => {
    const fetchImpl = okFetch();
    await expect(deliverPasswordResetEmail(readMailerConfig(ENV), { ...message, to: 'nope' }, { fetchImpl }))
      .rejects.toThrow(PasswordResetEmailError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never leaks the API key or provider body into the thrown error', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'key test-key invalid' }));
    const error = await deliverPasswordResetEmail(readMailerConfig(ENV), message, { fetchImpl })
      .catch((e) => e);
    expect(error).toBeInstanceOf(PasswordResetEmailError);
    expect(error.code).toBe('provider-rejected');
    expect(error.message).not.toContain('test-key');
  });

  it('turns a network failure into a provider error, not a crash', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); });
    const error = await deliverPasswordResetEmail(readMailerConfig(ENV), message, { fetchImpl })
      .catch((e) => e);
    expect(error.code).toBe('provider-unreachable');
  });
});
