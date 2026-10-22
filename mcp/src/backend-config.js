// Shared hosting configuration is the default on Vercel. Local MCP installs
// can still explicitly override it without changing the website's backend.
export function resolveMcpBackend(env = process.env) {
  const read = key => String(env[key] ?? '').trim();
  return {
    dataSource: (read('SWEATER_DATA_SOURCE') || read('DATA_SOURCE')) === 'supabase' ? 'supabase' : 'firebase',
    url: read('SWEATER_SUPABASE_URL') || read('SUPABASE_URL') || read('VITE_SUPABASE_URL'),
    publishableKey: read('SWEATER_SUPABASE_ANON_KEY') || read('VITE_SUPABASE_ANON_KEY'),
  };
}

export function resolveMcpAppOrigin(env = process.env) {
  const explicit = String(env.SWEATER_APP_URL ?? '').trim();
  const preview = String(env.VERCEL_ENV ?? '').trim() === 'preview';
  // Never send a preview's workflow requests to production by default.
  const previewHost = String(env.VERCEL_URL ?? '').trim();
  if (!explicit && preview && !previewHost) throw new Error('SWEATER_APP_URL or VERCEL_URL is required for MCP in Preview.');
  const url = new URL(explicit || (preview ? `https://${previewHost}` : 'https://sweater-hadi-alghanim.vercel.app'));
  if (url.protocol !== 'https:' && !(['http:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new Error('SWEATER_APP_URL must be https (or local http).');
  }
  if (url.username || url.password) throw new Error('SWEATER_APP_URL must not contain credentials.');
  return url.origin;
}
