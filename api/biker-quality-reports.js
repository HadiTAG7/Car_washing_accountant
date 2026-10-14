import { readQualityReports, saveQualityReports } from '../server/bikerQualityReports.js';
import { getBikerQualityRuntime } from '../server/bikerQualityRuntime.js';

export function createQualityHandler(getRuntime = getBikerQualityRuntime) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: { code: 'invalid-argument' } }); }
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1];
    if (!token) return res.status(401).json({ error: { code: 'unauthenticated', message: 'تسجيل الدخول مطلوب.' } });
    let runtime;
    try { runtime = getRuntime(); }
    catch { return res.status(503).json({ error: { code: 'unavailable', message: 'تعذّر تهيئة مسار الجودة.' } }); }
    let caller;
    try { caller = await runtime.auth.verifyIdToken(token, true); }
    catch { return res.status(401).json({ error: { code: 'unauthenticated', message: 'الجلسة غير صالحة.' } }); }
    try {
      if (Number(req.headers['content-length']) > 500000) return res.status(413).json({ error: { code: 'invalid-argument' } });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || !['read', 'save'].includes(body.operation) || Object.keys(body).some(k => !['operation', 'data'].includes(k))) {
        return res.status(400).json({ error: { code: 'invalid-argument', message: 'عملية غير صالحة.' } });
      }
      const result = await (body.operation === 'read' ? readQualityReports : saveQualityReports)(runtime.db, { uid: caller.uid }, body.data);
      return res.status(200).json({ result });
    } catch (error) {
      const statuses = { 'unauthenticated': 401, 'permission-denied': 403, 'invalid-argument': 400,
        'failed-precondition': 412, 'already-exists': 409 };
      const status = error instanceof SyntaxError ? 400 : statuses[error.code] || 500;
      if (status === 500) console.error('[biker-quality-reports] Request failed'); // Never log payloads, tokens or private assessments.
      return res.status(status).json({ error: { code: status === 500 ? 'internal' : error.code || 'invalid-argument',
        message: status === 500 ? 'تعذّر تحميل أو حفظ التقرير.' : error.message } });
    }
  };
}
export default createQualityHandler();
