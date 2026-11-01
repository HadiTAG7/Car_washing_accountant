import { getBikerQualityRuntime } from './bikerQualityRuntime.js';
import { compensationReview } from '../functions/src/compensationReview.js';
export function createCompensationReviewHandler(getRuntime = getBikerQualityRuntime) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Authorization');
    if (req.method !== 'POST') return res.status(405).json({ error: { code: 'invalid-argument' } });
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1];
    if (!token) return res.status(401).json({ error: { code: 'unauthenticated' } });
    let runtime, caller;
    try { runtime = getRuntime(); } catch { return res.status(503).json({ error: { code: 'unavailable' } }); }
    try { caller = await runtime.auth.verifyIdToken(token, true); }
    catch { return res.status(401).json({ error: { code: 'unauthenticated' } }); }
    try {
      if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})) > 180000)
        return res.status(413).json({ error: { code: 'invalid-argument', message: 'حزمة المصدر أكبر من حد الحفظ.' } });
      const result = await compensationReview(runtime.db, typeof req.body === 'string' ? JSON.parse(req.body) : req.body,
        { uid: caller.uid, token: caller });
      return res.status(200).json({ result });
    } catch (e) {
      const code = e instanceof SyntaxError ? 'invalid-argument' : e.code;
      return res.status({ 'permission-denied':403, 'unauthenticated':401,'not-found':404,'invalid-argument':400,'aborted':409,'already-exists':409,'failed-precondition':412 }[code] || 500)
        .json({ error: { code: code || 'internal', message: code ? e.message : 'تعذر حفظ المراجعة؛ أعد قراءة السجل قبل تكرار الطلب.' } });
    }
  };
}
export default createCompensationReviewHandler();

