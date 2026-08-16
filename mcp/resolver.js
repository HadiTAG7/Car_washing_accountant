// ═══════════════════════════════════════════════════════════════════════════
// خُطّاف حلّ الاستيراد — ليقرأ Node ما يقرؤه Vite
// ═══════════════════════════════════════════════════════════════════════════
// The app's modules import each other without a file extension —
// `from './journal'` — which is a bundler convention, not ESM. Vite resolves
// it, vitest resolves it (it uses Vite's resolver), and plain Node does not:
//
//     ERR_MODULE_NOT_FOUND  file:///…/src/lib/accounting/journal
//
// Three ways out, and why this one:
//
//   ✗ Add `.js` everywhere — 603 imports across 125 files. A mechanical diff
//     that size, touching the whole app, to serve one new tool, is a bad
//     trade: all of the risk lands on code that was working.
//   ✗ Add `.js` only to what this server pulls in — five imports today, and
//     silently broken the day someone adds a sixth to `reports.js` without
//     one. A fix that depends on nobody writing ordinary code is not a fix.
//   ✓ Resolve it here. Contained in `mcp/`, touches no app file, and stays
//     correct however the shared modules grow.
//
// The alternative to sharing at all — copying the report functions into this
// package — is the one option that must not happen: two implementations of
// «what is my profit» drift, and the day they drift the assistant quotes a
// number the app disagrees with, confidently and with nothing looking wrong.
//
// Deliberately narrow: it only ever retries a RELATIVE, extensionless
// specifier that already failed, and only by appending `.js`. A genuinely
// missing module still fails, with its original error.
// ═══════════════════════════════════════════════════════════════════════════

const RELATIVE = /^\.{1,2}\//;
const HAS_EXTENSION = /\.[a-zA-Z0-9]+$/;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const retryable = err?.code === 'ERR_MODULE_NOT_FOUND'
      && RELATIVE.test(specifier)
      && !HAS_EXTENSION.test(specifier);
    if (!retryable) throw err;
    return nextResolve(`${specifier}.js`, context);
  }
}
