import { getBikerQualityRuntime } from '../server/bikerQualityRuntime.js';
import { readGrowthPerformance } from '../server/growthPerformance.js';

export function createGrowthHandler(getRuntime = getBikerQualityRuntime) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: { code: 'invalid-argument' } }); }
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1];
    if (!token) return res.status(401).json({ error: { code: 'unauthenticated' } });
    let runtime, caller;
    try { runtime = getRuntime(); }
    catch { return res.status(503).json({ error: { code: 'unavailable' } }); }
    try { caller = await runtime.auth.verifyIdToken(token, true); }
    catch { return res.status(401).json({ error: { code: 'unauthenticated' } }); }
    try {
      if (Number(req.headers['content-length']) > 2048) return res.status(413).json({ error: { code: 'invalid-argument' } });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const result = await readGrowthPerformance(runtime.db, { uid: caller.uid }, body);
      return res.status(200).json({ result });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : ({ 'permission-denied': 403, 'unauthenticated': 401,
        'invalid-argument': 400, 'failed-precondition': 412 }[error.code] || 500);
      return res.status(status).json({ error: { code: status === 500 ? 'internal' : error.code || 'invalid-argument',
        message: status === 500 ? 'تعذر قراءة بيانات النمو؛ لم تتغير بيانات التشغيل.' : error.message } });
    }
  };
}
export default createGrowthHandler();
