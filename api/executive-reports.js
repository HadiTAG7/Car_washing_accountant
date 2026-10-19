import { getBikerQualityRuntime } from '../server/bikerQualityRuntime.js';
import { executiveReports } from '../server/executiveReports.js';

export function createExecutiveHandler(getRuntime=getBikerQualityRuntime){
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:{code:'invalid-argument'}});}
    const token=/^Bearer (.+)$/.exec(String(req.headers.authorization||''))?.[1];
    if(!token)return res.status(401).json({error:{code:'unauthenticated',message:'تسجيل الدخول مطلوب.'}});
    let runtime,caller;
    try{runtime=getRuntime();}catch{return res.status(503).json({error:{code:'unavailable',message:'مسار التقارير غير متاح.'}});}
    try{caller=await runtime.auth.verifyIdToken(token,true);}catch{return res.status(401).json({error:{code:'unauthenticated',message:'الجلسة غير صالحة.'}});}
    try{
      if(Number(req.headers['content-length'])>66000)return res.status(413).json({error:{code:'invalid-argument',message:'الملف أكبر من الحد المسموح.'}});
      const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
      if(Buffer.byteLength(JSON.stringify(body)||'','utf8')>66000)return res.status(413).json({error:{code:'invalid-argument'}});
      return res.status(200).json({result:await executiveReports(runtime.db,{uid:caller.uid},body)});
    }catch(error){
      if([8,'resource-exhausted','firestore/resource-exhausted'].includes(error?.code))return res.status(503).json({error:{code:'resource-exhausted',message:'حصة قراءة قاعدة البيانات مستنفدة؛ لم نثبت نجاح الحفظ. أعد القراءة قبل أي محاولة حفظ لاحقة.'}});
      const status=error instanceof SyntaxError?400:({'permission-denied':403,'unauthenticated':401,'invalid-argument':400,'failed-precondition':412,'already-exists':409,'not-found':404}[error?.code]||500);
      return res.status(status).json({error:{code:status===500?'internal':error.code||'invalid-argument',message:status===500?'تعذّر إكمال طلب التقرير. تحقق من النسخة المحفوظة قبل إعادة الحفظ.':error instanceof SyntaxError?'ملف JSON غير صالح.':error.message}});
    }
  };
}
export default createExecutiveHandler();
