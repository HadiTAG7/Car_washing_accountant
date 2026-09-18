// ═══════════════════════════════════════════════════════════════════════════
// المدخل عبر stdio — لجهازٍ واحد (Claude Desktop · Claude Code)
// ═══════════════════════════════════════════════════════════════════════════
// التركيب في `build.js` مشتركٌ مع النسخة البعيدة؛ هنا النقل وحده. الاتصال
// بـ Firebase كسول: سردُ الأدوات لا يحتاج بيانات دخول، فعميلٌ يسرد عند
// الإقلاع لا يفشل لأن البيئة لم تُضبط بعد — يفشل عند أول استعمال، برسالةٍ
// تسمّي المتغيّر.
// ═══════════════════════════════════════════════════════════════════════════

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildSweaterServer } from './build.js';
import { readOnly } from './client.js';

const server = buildSweaterServer({ writes: !readOnly });
await server.connect(new StdioServerTransport());
