// ═══════════════════════════════════════════════════════════════════════════
// تنفيذ SQL خام عبر HTTPS — حين لا يصل اتصال Postgres المباشر
// ═══════════════════════════════════════════════════════════════════════════
// واجهة إدارة Supabase تنفّذ نص SQL كما هو، كل طلب في جلسة وعملية مستقلة،
// بلا معاملات مربوطة. فالسكربت يبني نصاً كاملاً بقيم حرفية، ويعامل كل طلب
// كعملية واحدة: عدة جمل في طلب واحد = عملية ضمنية واحدة (كلها أو لا شيء).
//
// pgSqlTransport يفعل الشيء نفسه على قاعدة محلية (اتصال جديد لكل طلب، نص
// خام بلا معاملات) — لتجربة المسار نفسه حرفياً قبل المشروع البعيد.
// ═══════════════════════════════════════════════════════════════════════════
import pg from 'pg';

/**
 * A value as an SQL literal, coerced by the column exactly as an untyped bind
 * parameter is (node-pg sends numbers and booleans as their text too).
 */
export function literal(value) {
  if (value === null || value === undefined) return 'null';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (text.includes('\u0000')) throw new Error('NUL in a value');
  return `'${text.replace(/'/g, "''")}'`;
}

/** Raw SQL on a local database, one fresh session per call — the API's semantics. */
export function pgSqlTransport(connectionString) {
  return {
    name: 'sql-local',
    target: connectionString.replace(/:[^:@/]+@/, ':***@'),
    async run(sql) {
      const client = new pg.Client({ connectionString });
      await client.connect();
      try {
        const res = await client.query(sql);
        const last = Array.isArray(res) ? res.at(-1) : res;
        return last?.rows ?? [];
      } finally { await client.end().catch(() => {}); }
    },
  };
}

/** Raw SQL through Supabase's Management API (POST /v1/projects/{ref}/database/query). */
export function managementApiTransport({ ref, token, fetchImpl = fetch, retries = 5 }) {
  if (!ref || !token) throw new Error('managementApiTransport: project ref and access token are required.');
  const url = `https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`;
  return {
    name: 'management-api',
    target: `supabase:${ref}`,
    async run(sql) {
      for (let attempt = 1; ; attempt += 1) {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql }),
        });
        const body = await res.json().catch(() => null);
        if (res.ok) return Array.isArray(body) ? body : [];
        // Rate limit or a passing server error: wait and send the same text again.
        // A statement error (4xx) is never retried — it is the answer.
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        throw new Error(`${res.status}: ${body?.message || body?.error || 'request failed'}`);
      }
    },
  };
}
