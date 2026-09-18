// ═══════════════════════════════════════════════════════════════════════════
// خادم MCP البعيد — نفس الأدوات، من أي جهاز، ومع أي مساعد
// ═══════════════════════════════════════════════════════════════════════════
// `mcp/server.js` يعمل عبر stdio على جهاز واحد. وهذا لا يكفي هدفين قيلا
// صراحةً: الاستعمال من أكثر من جهاز، والاستعمال من ChatGPT — الذي لا يتصل
// بـ stdio إطلاقاً، فكل موصِّلاته HTTP.
//
// فهذه هي النسخة البعيدة. والأدوات **هي هي**: `mcp/src/tools.js` مستوردٌ كما
// هو، لأنه لم يعرف وسيلة نقل يوماً. لا نسخة ثانية من «كيف يُحسب ميزان
// المراجعة» ولا من «مَن يحقّ له عكس قيد».
//
// ═══ الفرق الأمني، مقولاً قبل أي شيء آخر ═══
// النسخة المحلية سرّها ملفٌ على جهازك. وهذه على **رابط عام**، فالرابط نفسه هو
// المفتاح: `/api/mcp/<سرّ طويل عشوائي>`. من يعرف الرابط يدخل.
//
// ولذلك:
//   • الكتابة **معطَّلة افتراضياً**. `MCP_ALLOW_WRITES=1` وحده يفتحها، ولا
//     تُعرَض أدوات الكتابة في القائمة أصلاً وهي مغلقة. مساعدٌ لا يرى الأداة
//     لا يمكن إقناعه باستعمالها، والرابط المسرَّب يقرأ ولا يكتب.
//   • المقارنة `timingSafeEqual` لا `===`. مقارنة النصوص تتوقف عند أول حرف
//     مختلف، فزمنها يسرّب طول البادئة الصحيحة حرفاً حرفاً.
//   • الحساب الذي يعمل به الخادم يظل بدور `accountant` لا `admin`: حتى لو
//     فُتحت الكتابة وتسرّب الرابط، لا يستطيع أحد **إعادة فتح فترة مقفلة**.
//
// وكل كتابة — إن فُتحت — تمرّ بـ `callServer` أي باستدعاءات الخادم الموثوق،
// كما في النسخة المحلية بالضبط. لا شيء هنا يكتب في Firestore مباشرة.
// ═══════════════════════════════════════════════════════════════════════════

import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { buildSweaterServer } from '../../mcp/src/build.js';

const env = (n) => String(process.env[n] ?? '').trim();

/** Fixed-time comparison — a plain `===` leaks the correct prefix length. */
function secretMatches(given, expected) {
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const writesAllowed = () => ['1', 'true', 'yes'].includes(env('MCP_ALLOW_WRITES').toLowerCase());

// التركيب — الأدوات والتعليمات والـ prompts — في `mcp/src/build.js` مشتركاً مع
// نسخة stdio، فلا تنحرف إحداهما عن الأخرى.
const buildServer = () => buildSweaterServer({ writes: writesAllowed() });

export const config = { api: { bodyParser: false } };

/**
 * Vercel fills `req.query` from the dynamic route; a plain Node server does
 * not. Reading the path as a fallback keeps this file host-neutral — it runs
 * behind `http.createServer` on Render or Fly unchanged — and is what lets the
 * suite drive it through a real HTTP client rather than a stub.
 */
function secretFrom(req) {
  if (req.query?.secret) return req.query.secret;
  const path = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
}

/** Plain Node, not Vercel's `res.status().json()` sugar — same reason. */
function fail(res, code, payload) {
  res.statusCode = code;
  if (payload === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  const expected = env('MCP_SECRET');
  if (!expected) {
    return fail(res, 503, {
      error: 'MCP_SECRET غير مضبوط على المستضيف — الخادم البعيد معطَّل حتى يُضبط.',
    });
  }
  // ...والسرّ من المسار، لأنه ما تقبله واجهات الموصِّلات: رابطٌ واحد يُلصَق.
  //
  // و404 لا 403: ردٌّ يقول «سرّ خاطئ» يؤكّد لمن يجرّب أن العنوان صحيح وأن
  // الباقي تخمين. 404 لا يقول شيئاً.
  if (!secretMatches(secretFrom(req), expected)) return fail(res, 404);

  // Stateless: serverless gives no guarantee the next request lands on the
  // same instance, so a session id held in memory would work until it did not
  // — the worst kind of failure, intermittent and unreproducible.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  res.on('close', () => { transport.close(); server.close(); });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: `تعذّر تشغيل خادم MCP: ${e?.message || e}` });
    }
  }
}
