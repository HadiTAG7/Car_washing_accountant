import { describe, it, expect } from 'vitest';
import { partnerMcpUrl, partnerMcpBaseUrl } from '../partnerMcpUrl';

const TOKEN = `pmk_${'a'.repeat(43)}`;

describe('رابط MCP الشريك — أصله بالترتيب', () => {
  it('المتغيّر الصريح يعلو على كل شيء، ويُشذَّب من الشرطة الأخيرة', () => {
    const url = partnerMcpUrl(TOKEN, {
      env: { VITE_PARTNER_MCP_BASE_URL: 'https://app.example.com/' },
      ledgerApiUrl: 'https://other.example.com/api/ledger',
      location: { origin: 'https://localhost' },
    });
    expect(url).toBe(`https://app.example.com/api/partner-mcp/${TOKEN}`);
  });

  it('ثم أصلُ منفذ الخادم الموثوق — لا مساره', () => {
    expect(partnerMcpBaseUrl({ env: {}, ledgerApiUrl: 'https://erp.example.com/api/ledger', location: { origin: 'https://localhost' } }))
      .toBe('https://erp.example.com');
  });

  it('ثم أصل الصفحة — وهو ما يكفي في المتصفح', () => {
    expect(partnerMcpBaseUrl({ env: {}, ledgerApiUrl: '', location: { origin: 'https://monster-wash-erp.vercel.app' } }))
      .toBe('https://monster-wash-erp.vercel.app');
  });

  it('ومنفذٌ نسبي لا يُكسر شيئاً — يُتجاوز إلى الصفحة', () => {
    expect(partnerMcpBaseUrl({ env: {}, ledgerApiUrl: '/api/ledger', location: { origin: 'https://x.test' } }))
      .toBe('https://x.test');
  });

  it('والرمز يُرمَّز في المسار', () => {
    expect(partnerMcpUrl('a b', { location: { origin: 'https://x.test' } })).toBe('https://x.test/api/partner-mcp/a%20b');
  });
});
