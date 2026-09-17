import { describe, expect, it } from 'vitest';
import {
  PROVIDERS, checkDomain, formatReport, inspectDkim, inspectDmarc, inspectSpf,
  organizationalDomain, parseArgs,
} from '../check-email-deliverability.mjs';

const RESEND = PROVIDERS.resend;

describe('parseArgs', () => {
  it('takes the domain out of a full address, a URL, or a bare name', () => {
    expect(parseArgs(['no-reply@sweater.test']).domain).toBe('sweater.test');
    expect(parseArgs(['https://Sweater.TEST/path']).domain).toBe('sweater.test');
    expect(parseArgs(['sweater.test']).domain).toBe('sweater.test');
  });

  it('reads the provider in both spellings and defaults to Resend', () => {
    expect(parseArgs(['d.test']).provider).toBe('resend');
    expect(parseArgs(['d.test', '--provider', 'SendGrid']).provider).toBe('sendgrid');
    expect(parseArgs(['d.test', '--provider=mailgun']).provider).toBe('mailgun');
  });
});

describe('inspectSpf', () => {
  it('reports a missing record with the line to paste', () => {
    const result = inspectSpf([], RESEND);
    expect(result.ok).toBe(false);
    expect(result.fix).toContain('v=spf1 include:_spf.resend.com ~all');
  });

  it('flags two SPF records, which the spec turns into permerror', () => {
    // «أضفت سجلاً ثانياً» عطلٌ صامت: الاثنان يبطلان بعضهما لا يتراكمان.
    const result = inspectSpf(['v=spf1 include:a.test ~all', 'v=spf1 include:b.test ~all'], RESEND);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('permerror');
  });

  it('flags a record that exists but does not authorize the provider', () => {
    expect(inspectSpf(['v=spf1 include:_spf.google.com ~all'], RESEND).ok).toBe(false);
  });

  it('accepts an authorizing record, and warns when it has no all mechanism', () => {
    expect(inspectSpf(['v=spf1 include:_spf.resend.com ~all'], RESEND))
      .toMatchObject({ ok: true, level: 'ok' });
    expect(inspectSpf(['v=spf1 include:_spf.resend.com'], RESEND))
      .toMatchObject({ ok: true, level: 'warn' });
  });

  it('accepts SPF published on the provider-managed return path', () => {
    // SPF يتحقّق من مُرسِل الغلاف لا من From، والمزوّد يضعه على نطاقه الفرعي.
    // الفحص على نطاق الإرسال وحده كان يقول «مفقود» لضبطٍ سليم تماماً.
    const result = inspectSpf([], RESEND, {
      returnPath: [{ name: 'send.d.test', records: ['v=spf1 ip4:52.3.252.119 ~all'] }],
    });
    expect(result).toMatchObject({ ok: true, level: 'ok' });
    expect(result.message).toContain('send.d.test');
  });

  it('still fails when neither the domain nor the return path carries one', () => {
    expect(inspectSpf([], RESEND, {
      returnPath: [{ name: 'send.d.test', records: [] }],
    })).toMatchObject({ ok: false, level: 'error' });
  });

  it('prefers the record on the sending domain over the return path', () => {
    const result = inspectSpf(['v=spf1 include:_spf.resend.com ~all'], RESEND, {
      returnPath: [{ name: 'send.d.test', records: ['v=spf1 ip4:1.2.3.4 ~all'] }],
    });
    expect(result.message).not.toContain('مسار العودة');
  });

  it('ignores unrelated TXT records sharing the root', () => {
    const records = ['google-site-verification=abc', 'v=spf1 include:_spf.resend.com -all'];
    expect(inspectSpf(records, RESEND).ok).toBe(true);
  });
});

describe('inspectDkim', () => {
  it('passes as soon as one selector answers', () => {
    const result = inspectDkim([
      { name: 's1._domainkey.d.test', records: [] },
      { name: 's2._domainkey.d.test', records: ['k=rsa; p=MII...'] },
    ], PROVIDERS.sendgrid);
    expect(result.ok).toBe(true);
    expect(result.found).toEqual(['s2._domainkey.d.test']);
  });

  it('fails when no selector answers', () => {
    expect(inspectDkim([{ name: 'resend._domainkey.d.test', records: [] }], RESEND).ok).toBe(false);
  });

  it('warns rather than fails where the selectors cannot be guessed', () => {
    // SES يعطي كل حساب مُحدِّدات خاصة؛ «لم أجد» هنا لا يعني «غير موجود».
    expect(inspectDkim([], PROVIDERS.ses)).toMatchObject({ ok: false, level: 'warn' });
  });
});

describe('inspectDmarc', () => {
  it('reports a missing record with the line to paste', () => {
    expect(inspectDmarc([]).fix).toContain('v=DMARC1; p=none');
  });

  it('recommends no alignment tags, so a sub-domain return path still aligns', () => {
    // aspf=s كان سيُسقط محاذاة SPF حين يعيش مسار العودة على نطاق فرعي،
    // فيترك DKIM وحده بلا احتياطي. الافتراضي المرن هو الصحيح هنا.
    expect(inspectDmarc([]).fix).not.toContain('aspf=s');
  });

  it('accepts p=none as a start but keeps it a warning', () => {
    expect(inspectDmarc(['v=DMARC1; p=none; rua=mailto:x@d.test']))
      .toMatchObject({ ok: true, level: 'warn' });
  });

  it('treats an enforcing policy with strict alignment as done', () => {
    const result = inspectDmarc(['v=DMARC1; p=reject; adkim=s; aspf=s']);
    expect(result).toMatchObject({ ok: true, level: 'ok' });
    expect(result.message).toContain('محاذاة صارمة');
  });

  it('names the parent when the record was inherited', () => {
    const result = inspectDmarc(['v=DMARC1; p=reject'], { inheritedFrom: 'example.com' });
    expect(result.message).toContain('موروث من example.com');
  });

  it('reads sp= as the policy that actually governs an inherited subdomain', () => {
    // p= تحكم النطاق الأعلى؛ الفرعيّ تحكمه sp= متى وُجدت.
    expect(inspectDmarc(['v=DMARC1; p=reject; sp=none'], { inheritedFrom: 'example.com' }))
      .toMatchObject({ level: 'warn' });
    expect(inspectDmarc(['v=DMARC1; p=none; sp=reject'], { inheritedFrom: 'example.com' }))
      .toMatchObject({ level: 'ok' });
    // وبلا وراثة، sp= لا تخصّنا.
    expect(inspectDmarc(['v=DMARC1; p=reject; sp=none'])).toMatchObject({ level: 'ok' });
  });
});

describe('organizationalDomain', () => {
  it('reduces a sub-domain to its last two labels, and leaves a root alone', () => {
    expect(organizationalDomain('mail.example.com')).toBe('example.com');
    expect(organizationalDomain('a.b.example.com')).toBe('example.com');
    expect(organizationalDomain('example.com')).toBe('example.com');
  });
});

describe('checkDomain', () => {
  /** مُحلِّل أسماء مزيّف: الفحص عن قراءة السجلات لا عن DNS نفسه. */
  function resolverFor(zone) {
    return {
      resolveTxt: async (name) => {
        if (!(name in zone)) throw new Error('ENOTFOUND');
        return zone[name].map((value) => [value]);
      },
      resolveCname: async () => { throw new Error('ENOTFOUND'); },
    };
  }

  it('reads all three records and reports a ready domain', async () => {
    const resolver = resolverFor({
      'sweater.test': ['v=spf1 include:_spf.resend.com ~all'],
      '_dmarc.sweater.test': ['v=DMARC1; p=quarantine; adkim=s; aspf=s'],
      'resend._domainkey.sweater.test': ['k=rsa; p=MII...'],
    });
    const result = await checkDomain('sweater.test', 'resend', { resolver });
    expect(result.ready).toBe(true);
    expect(formatReport(result)).toContain('السجلات الثلاثة منشورة');
  });

  it('is not ready while any record is missing', async () => {
    const resolver = resolverFor({ 'sweater.test': ['v=spf1 include:_spf.resend.com ~all'] });
    const result = await checkDomain('sweater.test', 'resend', { resolver });
    expect(result.ready).toBe(false);
    expect(result.checks.dkim.ok).toBe(false);
    expect(result.checks.dmarc.ok).toBe(false);
    expect(formatReport(result)).toContain('ستبقى الرسالة في السبام');
  });

  it('treats a lookup failure as absence, not as a crash', async () => {
    const resolver = { resolveTxt: async () => { throw new Error('ESERVFAIL'); },
      resolveCname: async () => { throw new Error('ESERVFAIL'); } };
    await expect(checkDomain('sweater.test', 'resend', { resolver })).resolves
      .toMatchObject({ ready: false });
  });

  it('inherits the DMARC record from the organizational domain', async () => {
    // بلا هذا كان الفاحص يقول «لا يوجد DMARC» لنطاق فرعي محميّ فعلاً،
    // فيرسل صاحبه يصلح ما ليس مكسوراً.
    const resolver = resolverFor({
      'mail.sweater.test': ['v=spf1 include:_spf.resend.com ~all'],
      'resend._domainkey.mail.sweater.test': ['k=rsa; p=MII...'],
      '_dmarc.sweater.test': ['v=DMARC1; p=quarantine; adkim=s; aspf=s'],
    });
    const result = await checkDomain('mail.sweater.test', 'resend', { resolver });
    expect(result.checks.dmarc.ok).toBe(true);
    expect(result.checks.dmarc.message).toContain('موروث من sweater.test');
    expect(result.ready).toBe(true);
  });

  it('reads a real Resend zone as ready once DMARC exists', async () => {
    // شكل المنطقة كما ينشرها Resend فعلاً: SPF على send.، DKIM على النطاق.
    const resolver = resolverFor({
      'send.mail.sweater.test': ['v=spf1 ip4:52.3.252.119 ~all'],
      'resend._domainkey.mail.sweater.test': ['p=MIGfMA0GCSq...'],
      '_dmarc.sweater.test': ['v=DMARC1; p=none; rua=mailto:d@sweater.test'],
    });
    const result = await checkDomain('mail.sweater.test', 'resend', { resolver });
    expect(result.checks.spf.ok).toBe(true);
    expect(result.checks.spf.message).toContain('send.mail.sweater.test');
    expect(result.ready).toBe(true);
  });

  it('prefers the sub-domain own record over the inherited one', async () => {
    const resolver = resolverFor({
      'mail.sweater.test': ['v=spf1 include:_spf.resend.com ~all'],
      'resend._domainkey.mail.sweater.test': ['k=rsa; p=MII...'],
      '_dmarc.mail.sweater.test': ['v=DMARC1; p=reject; adkim=s; aspf=s'],
      '_dmarc.sweater.test': ['v=DMARC1; p=none'],
    });
    const result = await checkDomain('mail.sweater.test', 'resend', { resolver });
    expect(result.checks.dmarc.message).not.toContain('موروث');
    expect(result.checks.dmarc.level).toBe('ok');
  });

  it('does not look for a parent when the domain is already organizational', async () => {
    const resolver = resolverFor({ 'sweater.test': ['v=spf1 include:_spf.resend.com ~all'] });
    const result = await checkDomain('sweater.test', 'resend', { resolver });
    expect(result.checks.dmarc.ok).toBe(false);
  });

  it('refuses an unknown provider and an invalid domain', async () => {
    const resolver = resolverFor({});
    await expect(checkDomain('sweater.test', 'pigeon', { resolver })).rejects.toThrow(/مزوّد/);
    await expect(checkDomain('not a domain', 'resend', { resolver })).rejects.toThrow(/نطاق/);
  });
});
