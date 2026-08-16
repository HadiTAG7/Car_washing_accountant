#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// نقطة الإقلاع — تسجّل خُطّاف الاستيراد ثم تسلّم للخادم
// ═══════════════════════════════════════════════════════════════════════════
// This file exists to be almost empty, and the order is the reason.
//
// `register()` has to take effect BEFORE anything that needs it is resolved,
// and static `import` statements are hoisted — they run before any code in the
// module body. So the real server cannot be a static import here; it is
// pulled in dynamically, after the hook is in place.
//
// Put another way: if line 20 were `import './src/main.js'`, the hook on
// line 18 would be installed too late and the server would die exactly as it
// did before the hook existed. `test/server.test.js` boots this file as a real
// process, which is what would catch that.
// ═══════════════════════════════════════════════════════════════════════════

import { register } from 'node:module';

register('./resolver.js', import.meta.url);

await import('./src/main.js');
