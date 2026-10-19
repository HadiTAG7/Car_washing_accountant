import { getBikerQualityRuntime } from '../server/bikerQualityRuntime.js';
import { financeWorkbench } from '../server/financeWorkbench.js';

export function createFinanceWorkbenchHandler(getRuntime = getBikerQualityRuntime) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Authorization');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: { code: 'invalid-argument' } }); }
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1];
    if (!token) return res.status(401).json({ error: { code: 'unauthenticated' } });
    let runtime, caller;
    try { runtime = getRuntime(); } catch { return res.status(503).json({ error: { code: 'unavailable' } }); }
    try { caller = await runtime.auth.verifyIdToken(token, true); } catch { return res.status(401).json({ error: { code: 'unauthenticated' } }); }
    try {
      if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null)) > 64000) return res.status(413).json({ error: { code: 'invalid-argument' } });
      const result = await financeWorkbench(runtime.db, { uid: caller.uid }, typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
      return res.status(200).json({ result });
    } catch (error) {
      const code = error instanceof SyntaxError ? 'invalid-argument' : error.code;
      const status = { 'permission-denied': 403, 'unauthenticated': 401, 'not-found': 404, 'invalid-argument': 400,
        'already-exists': 409, 'failed-precondition': 412, 8: 503, 'resource-exhausted': 503 }[code] || 500;
      return res.status(status).json({ error: { code: status === 500 ? 'internal' : code,
        message: status >= 500 ? 'تعذر إتمام المسار؛ تحقق من المصدر والقيود قبل الإعادة.' : error.message } });
    }
  };
}
export default createFinanceWorkbenchHandler();
