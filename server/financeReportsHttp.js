import { getBikerQualityRuntime } from './bikerQualityRuntime.js';
import { financeReports } from './financeReports.js';

export function createFinanceReportsHandler(getRuntime = getBikerQualityRuntime) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: { code: 'invalid-argument' } }); }
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1];
    if (!token) return res.status(401).json({ error: { code: 'unauthenticated' } });
    let runtime, caller;
    try { runtime = getRuntime(); } catch { return res.status(503).json({ error: { code: 'unavailable' } }); }
    try { caller = await runtime.auth.verifyIdToken(token, true); } catch { return res.status(401).json({ error: { code: 'unauthenticated' } }); }
    try {
      if (Number(req.headers['content-length']) > 102400) return res.status(413).json({ error: { code: 'invalid-argument' } });
      if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null)) > 102400) {
        return res.status(413).json({ error: { code: 'invalid-argument' } });
      }
      const input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const result = await financeReports(runtime.db, { uid: caller.uid }, input);
      return res.status(200).json({ result });
    } catch (error) {
      const code = error instanceof SyntaxError ? 'invalid-argument' : error.code;
      const status = { 'permission-denied': 403, 'unauthenticated': 401, 'not-found': 404, 'invalid-argument': 400,
        'already-exists': 409, 'failed-precondition': 412, 'resource-exhausted': 503, 8: 503 }[code] || 500;
      return res.status(status).json({ error: { code: status === 500 ? 'internal' : code,
        message: status === 500 || status === 503 ? 'تعذر إتمام طلب تقرير المالية؛ اقرأ النتيجة قبل إعادة الحفظ.' : error.message } });
    }
  };
}
export default createFinanceReportsHandler();
