import { describe, expect, it } from 'vitest';
import {
  PROVIDERS, checkDomain, formatReport, inspectDkim, inspectDmarc, inspectSpf, parseArgs,
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

  it('accepts p=none as a start but keeps it a warning', () => {
    expect(inspectDmarc(['v=DMARC1; p=none; rua=mailto:x@d.test']))
      .toMatchObject({ ok: true, level: 'warn' });
  });

  it('treats an enforcing policy with strict alignment as done', () => {
    const result = inspectDmarc(['v=DMARC1; p=reject; adkim=s; aspf=s']);
    expect(result).toMatchObject({ ok: true, level: 'ok' });
    expect(result.message).toContain('محاذاة صارمة');
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

  it('refuses an unknown provider and an invalid domain', async () => {
    const resolver = resolverFor({});
    await expect(checkDomain('sweater.test', 'pigeon', { resolver })).rejects.toThrow(/مزوّد/);
    await expect(checkDomain('not a domain', 'resend', { resolver })).rejects.toThrow(/نطاق/);
  });
});
