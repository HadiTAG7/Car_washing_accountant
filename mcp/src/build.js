// ═══════════════════════════════════════════════════════════════════════════
// بناء الخادم — نسخةٌ واحدة تركّب الأدوات والتعليمات والـ prompts
// ═══════════════════════════════════════════════════════════════════════════
// كان `main.js` (stdio) و`api/mcp/[secret].js` (HTTP) يكرّران التركيب حرفياً:
// حلقةُ تسجيلٍ وغلافُ أخطاء. ولمّا أُضيفت التعليمات والـ prompts صار التكرار
// انحرافاً مضموناً — ينسى أحدهما ما يضيفه الآخر. فالتركيب هنا مرة، والنقل
// وحده يبقى في كلٍّ منهما.
// ═══════════════════════════════════════════════════════════════════════════

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readTools, writeTools } from './tools.js';
import { SERVER_INSTRUCTIONS, PROMPTS } from './instructions.js';

/**
 * يُرجع خادماً مركَّباً غير متصل؛ المستدعي يختار النقل.
 * `writes` تقرّر أن تُعرَض أدوات الكتابة أصلاً — ما لا يُعرض لا يُقنَع به.
 */
export function buildSweaterServer({ writes = false } = {}) {
  const server = new McpServer(
    { name: 'sweater', version: '1.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const tools = writes ? [...readTools, ...writeTools] : readTools;

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.schema },
      async (args) => {
        try {
          return await tool.run(args ?? {});
        } catch (e) {
          // رفضُ الخادم الموثوق — «الفترة مقفلة»، «الدور لا يسمح» — معلومةٌ
          // يقرؤها المساعد ويتصرّف، لا انهيار. ضياعها يتركه يكرّر المحاولة على
          // قاعدةٍ لن تلين.
          const problems = Array.isArray(e?.problems) && e.problems.length
            ? `\n\nالتفاصيل:\n- ${e.problems.join('\n- ')}` : '';
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `تعذّر تنفيذ ${tool.name}: ${e?.message || e}${problems}`
                + (e?.code ? `\n(code: ${e.code})` : ''),
            }],
          };
        }
      },
    );
  }

  for (const p of PROMPTS) {
    const argsSchema = Object.fromEntries(Object.entries(p.args || {}).map(([k, v]) => {
      let s = z.string().describe(v.description || k);
      if (!v.required) s = s.optional();
      return [k, s];
    }));
    server.registerPrompt(
      p.name,
      { title: p.title, description: p.description, argsSchema },
      (args) => ({ messages: [{ role: 'user', content: { type: 'text', text: p.text(args || {}) } }] }),
    );
  }

  return server;
}
