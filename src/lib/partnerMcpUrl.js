// ═══════════════════════════════════════════════════════════════════════════
// رابط MCP الذي يُعرض للشريك — أصلُه ليس دائماً أصل الصفحة
// ═══════════════════════════════════════════════════════════════════════════
// في المتصفح `window.location.origin` هو الموقع نفسه، وهذا يكفي. لكن التطبيق
// يُشحن أيضاً داخل Capacitor على أندرويد، وأصلُه هناك `https://localhost` أو
// ما شابه — رابطٌ يُنسخ منه لا يصل إلى أي خادم. فالأصل يُؤخذ بالترتيب: متغيّرٌ
// صريح، ثم أصلُ منفذ الخادم الموثوق إن ضُبط، ثم الصفحة.
//
// دالةٌ نقيّة بتبعياتٍ تُمرَّر، فتُختبر بلا `window`.
// ═══════════════════════════════════════════════════════════════════════════

export const PARTNER_MCP_PATH = '/api/partner-mcp/';

export function partnerMcpBaseUrl({ env = {}, ledgerApiUrl = '', location = null } = {}) {
  const explicit = String(env.VITE_PARTNER_MCP_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const api = String(ledgerApiUrl || '').trim();
  if (api) {
    try { return new URL(api).origin; } catch { /* ليس رابطاً مطلقاً — يُتجاوز */ }
  }
  return String(location?.origin || '').replace(/\/+$/, '');
}

export function partnerMcpUrl(token, deps = {}) {
  const base = partnerMcpBaseUrl(deps);
  return `${base}${PARTNER_MCP_PATH}${encodeURIComponent(String(token || ''))}`;
}
