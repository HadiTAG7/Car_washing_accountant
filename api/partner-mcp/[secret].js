// ═══════════════════════════════════════════════════════════════════════════
// خادم MCP خاص بكل شريك — رابطٌ واحد، حصّةٌ واحدة، قراءةٌ فقط
// ═══════════════════════════════════════════════════════════════════════════
// `api/mcp/[secret].js` بابُ المحاسب: سرٌّ واحد في البيئة، وحسابٌ واحد يعمل به
// الخادم، وأدواتٌ ترى الدفاتر كاملة. وهذا بابُ الشريك، وكل شيءٍ فيه مقلوب:
//
//   • الرمز **في المسار** كما هناك — لأن هذا ما تقبله واجهات الموصِّلات في
//     Claude وChatGPT: رابطٌ يُلصَق — لكنه **لكل شريكٍ رمزُه**، يولّده هو من
//     صفحته ويبدّله ويُلغيه، والمخزَّن بصمتُه لا هو.
//   • الهوية من الرمز: بصمته → مفتاحه → شريكه → أن حسابه ما زال هو الحساب
//     المربوط. أيُّ حلقةٍ تنكسر = 404 واحد لا يقول أيَّها.
//   • القراءة بـ Admin SDK ثم **الترشيح بالشريك في الخادم**: القواعد تُعطي
//     دور `partner` المجموعات كاملةً، فالحدُّ لا يمكن أن يكون فيها.
//   • لا أداة كتابةٍ واحدة — ولا مفتاح بيئةٍ يفتحها.
//
// ── ما يحرسه هذا الرابط ──
// من يعرفه يقرأ حصّةَ صاحبه: نسبته، ورأس ماله، ونصيبه من نتيجة الشهر، وعدد
// الغسلات التي تعادل حصّته. لا أسماء عاملين ولا شركاء آخرين ولا دفاتر خام.
// وحدُّ معدلٍ لكل رمز، والرمز يظهر في سجلّات الطلبات عند المستضيف كأي رابطٍ
// سرّي — وعلاجه التبديل من الصفحة، لا الإنكار.
// ═══════════════════════════════════════════════════════════════════════════

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { getPartnerMcpRuntime } from '../../server/partnerMcp/runtime.js';
import { makeLoader } from '../../server/partnerMcp/data.js';
import { partnerTools } from '../../server/partnerMcp/tools.js';
import {
  isWellFormedToken, resolvePartnerMcpToken, touchPartnerMcpKey,
  RATE_COL, RATE_MAX_PER_WINDOW,
} from '../../functions/src/partnerMcpKeys.js';
import { checkRateLimit } from '../../functions/src/sweater/integrationKeys.js';

export const config = { api: { bodyParser: false } };

/**
 * Vercel يملأ `req.query` من المسار الديناميكي؛ خادم Node العادي لا. القراءة
 * من المسار احتياطاً تُبقي الملف محايداً عن المستضيف، وهي ما يتيح للاختبار أن
 * يقوده عبر عميل HTTP حقيقي. و`decodeURIComponent` ترمي على ترميزٍ مشوّه —
 * ورمزٌ مشوّه ليس رمزاً: 404.
 */
function secretFrom(req) {
  if (req.query?.secret) return String(req.query.secret);
  const path = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  try { return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)); }
  catch { return ''; }
}

/** Node عادي لا سكّر Vercel — لنفس السبب. */
function fail(res, code, payload) {
  res.statusCode = code;
  res.setHeader('Cache-Control', 'no-store');
  if (payload === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(payload));
}

/**
 * مصنعٌ بتبعياتٍ قابلة للحقن — كما في `agent-command-center-ingest.js` —
 * فيُختبر المعالج بلا Firestore: `resolve` مزيّف يقول من صاحب الرمز، و`load`
 * مزيّف يعطي البيانات.
 */
export function createPartnerMcpHandler({
  runtimeFactory = getPartnerMcpRuntime,
  resolve = resolvePartnerMcpToken,
  rateLimit = checkRateLimit,
  touch = touchPartnerMcpKey,
  loaderFactory = makeLoader,
  tools = partnerTools,
  now = Date.now,
} = {}) {
  return async function handler(req, res) {
    const token = secretFrom(req);
    // الشكل أولاً: رمزٌ لا يشبه رموزنا لا يكلّف قاعدة البيانات قراءةً واحدة.
    if (!isWellFormedToken(token)) return fail(res, 404);

    let db; let FieldValue;
    try { ({ db, FieldValue } = runtimeFactory()); }
    catch (e) { return fail(res, 503, { error: e?.message || 'الخادم غير مضبوط.' }); }

    let principal;
    try { principal = await resolve(db, token); }
    catch (e) {
      console.error('[partner-mcp] تعذّر التحقق من الرمز', { message: e?.message });
      return fail(res, 500, { error: 'تعذّر التحقق من الرابط.' });
    }
    // 404 لا 403: «رمزٌ مُلغى» يؤكّد لمن يجرّب أنه أصاب رمزاً كان صحيحاً يوماً.
    if (!principal) return fail(res, 404);

    try {
      await rateLimit(db, FieldValue, principal.keyId, now(), { collection: RATE_COL, max: RATE_MAX_PER_WINDOW });
    } catch (e) {
      if (e?.code === 'resource-exhausted') return fail(res, 429, { error: e.message });
      console.error('[partner-mcp] تعذّر فحص حدّ المعدل', { keyId: principal.keyId, message: e?.message });
      return fail(res, 500, { error: 'تعذّر معالجة الطلب.' });
    }

    // «آخر استعمال» لا يُنتظر ولا يُفشِل الطلب — معلومةٌ للعرض لا شرطٌ للخدمة.
    Promise.resolve(touch(db, FieldValue, {
      keyId: principal.keyId, lastUsedAtIso: principal.lastUsedAtIso, nowMs: now(),
    })).catch(() => {});

    const load = loaderFactory(db, principal);
    const server = new McpServer({ name: 'sweater-partner', version: '1.0.0' });
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: tool.schema },
        async (args) => {
          try {
            return await tool.run(args ?? {}, { principal, load });
          } catch (e) {
            // يُسجَّل المعرّف لا الرمز؛ ويصل النصّ للمساعد ليقرأه لا ليُعيد المحاولة على عطلٍ ثابت.
            console.error('[partner-mcp] فشل أداة', { keyId: principal.keyId, tool: tool.name, message: e?.message });
            return {
              isError: true,
              content: [{ type: 'text', text: `تعذّر تنفيذ ${tool.name}: ${e?.message || e}` }],
            };
          }
        },
      );
    }

    // بلا جلسة: serverless لا يضمن أن الطلب التالي يصل نفس النسخة، ومعرّفٌ في
    // الذاكرة يعمل حتى لا يعمل — أسوأ الأعطال، متقطّعٌ ولا يُعاد.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      if (!res.headersSent) fail(res, 500, { error: `تعذّر تشغيل خادم MCP: ${e?.message || e}` });
    }
  };
}

export default createPartnerMcpHandler();
