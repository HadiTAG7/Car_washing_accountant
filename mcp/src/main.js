// ═══════════════════════════════════════════════════════════════════════════
// خادم MCP لسويتر — نقطة الدخول
// ═══════════════════════════════════════════════════════════════════════════
// Registers the tools and speaks MCP over stdio. Everything of substance is
// in `src/` so it can be tested without a transport.
//
// Two decisions live here rather than in the tool definitions:
//
//   • **Write tools are not registered at all in read-only mode.** Not
//     registered-and-refusing — absent. A tool the model cannot see is a tool
//     it cannot be talked into calling, and a refusal it never has to argue
//     with. `callServer` still refuses independently, so the guarantee does
//     not rest on this alone.
//
//   • **Errors come back as content, not as thrown exceptions.** A refusal
//     from the trusted server — «الفترة مقفلة», «الدور لا يسمح» — is
//     information the model should read and act on, not a crash. Losing that
//     text would leave it retrying blindly against a rule that will never
//     yield.
// ═══════════════════════════════════════════════════════════════════════════

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readTools, writeTools } from './tools.js';
import { readOnly } from './client.js';

const server = new McpServer({ name: 'sweater', version: '1.0.0' });

const tools = readOnly ? readTools : [...readTools, ...writeTools];

for (const tool of tools) {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.schema },
    async (args) => {
      try {
        return await tool.run(args ?? {});
      } catch (e) {
        const problems = Array.isArray(e?.problems) && e.problems.length
          ? `\n\nالتفاصيل:\n- ${e.problems.join('\n- ')}`
          : '';
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

await server.connect(new StdioServerTransport());
