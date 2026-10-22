import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../supabase/templates/recovery.html', import.meta.url), 'utf8');
const render = (origin) => new JSDOM(source
  .replaceAll('{{ .SiteURL }}', origin)
  .replaceAll('{{ .TokenHash }}', 'test_hash_not_real')
  .replaceAll('{{ .Email }}', 'test%2Bowner%40example.test')).window.document;

describe('Supabase recovery email template', () => {
  it('keeps the recovery link on the configured site without hardcoded deployment hosts', () => {
    for (const origin of ['https://app.example.test', 'https://preview.example.test']) {
      const document = render(origin);
      const links = [...document.querySelectorAll('a')];
      expect(links).toHaveLength(1);
      const link = new URL(links[0].href);
      expect(link.origin).toBe(origin);
      expect(link.pathname).toBe('/update-password');
      expect(link.searchParams.get('oobCode')).toBe('test_hash_not_real');
      expect(link.searchParams.get('email')).toBe('test+owner@example.test');
      expect(document.body.textContent).toContain(origin);
    }
    expect(source).not.toMatch(/https?:\/\//);
  });

  it('uses simple RTL account-recovery content without trackers or executable content', () => {
    const document = render('https://app.example.test');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.querySelectorAll('script, iframe, img, form')).toHaveLength(0);
    expect(document.body.textContent).toContain('إن لم تطلب ذلك');
    expect(document.body.textContent).toContain('لن نطلب منك إرسال كلمة مرورك');
    expect(document.body.textContent).toContain('استعادة كلمة المرور — سويتر');
  });
});
