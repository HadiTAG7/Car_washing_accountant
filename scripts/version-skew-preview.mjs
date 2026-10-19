// Isolated two-release reproduction. No Firebase, accounts or business records.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import process from 'node:process';
const port = Number(process.argv[2] || 5206);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local fixture port');
const template = readFileSync(new URL('./static-worker.js', import.meta.url), 'utf8');
let generation = 'A';
let apiReads = 0;
const pathFor = version => '/assets/FinanceWorkbenchPage-fixture' + version + '123456.js';
const html = version => `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>اختبار اختلاف نسخ سويتر المعزول</title><body style="background:#171717;color:#fff;font:18px/1.8 system-ui;padding:24px"><h1>اختبار نسختين — لا بيانات شركة</h1><p>هذه جلسة النسخة <b id="version">${version}</b></p><label>مسودة غير محفوظة<input aria-label="مسودة غير محفوظة" value="SYNTHETIC_DRAFT" style="display:block;width:90%;padding:10px"></label><p id="ready" role="status">جارٍ تجهيز حماية ملفات الواجهة</p><button id="publish">محاكاة نشر النسخة B</button> <button id="open">فتح صندوق العمل المالي التجريبي</button> <button id="api">قراءة تجريبية غير مخزنة</button><p id="result" role="status"></p><p id="api-result"></p><style>button{background:#d45300;color:white;border:1px solid #fa8a3c;border-radius:10px;min-height:44px;margin:8px;padding:8px;font:inherit}</style><script type="module">
const version=${JSON.stringify(version)};
const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
await navigator.serviceWorker.ready;
if(!navigator.serviceWorker.controller) await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
document.querySelector('#ready').textContent='حماية الملفات جاهزة للنسخة '+version;
document.querySelector('#publish').onclick=async()=>{await fetch('/__test/release-b',{method:'POST'});document.querySelector('#result').textContent='النسخة B منشورة محليًا؛ افتح تبويبًا جديدًا على الرابط نفسه، ثم ارجع إلى جلسة A.';};
document.querySelector('#open').onclick=async()=>{try{const module=await import(${JSON.stringify(pathFor(version))});document.querySelector('#result').textContent=module.message;}catch{document.querySelector('#result').textContent='فشل تحميل الملف القديم';}};
document.querySelector('#api').onclick=async()=>{document.querySelector('#api-result').textContent='قراءة الشبكة رقم '+(await(await fetch('/api/sentinel')).json()).read;};
</script></body></html>`;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/__test/release-b' && request.method === 'POST') { generation = 'B'; response.end('B'); return; }
  if (path === '/api/sentinel') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ read: ++apiReads })); return; }
  if (path === '/sw.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(template.replace("'__SW_BUILD__'", JSON.stringify(generation.repeat(40))).replace("'__SW_ASSETS__'", JSON.stringify([pathFor(generation)]))); return;
  }
  if (path === pathFor(generation)) { response.setHeader('Content-Type', 'application/javascript'); response.end('export const message=' + JSON.stringify('فتح صندوق العمل المالي من ملفات النسخة ' + generation + ' بنجاح — دون تحديث الصفحة')); return; }
  if (path.startsWith('/assets/')) { response.statusCode = 404; response.setHeader('Content-Type', 'text/plain'); response.end('removed from new deployment'); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html(generation));
});
server.listen(port, '127.0.0.1', () => console.log('Isolated A/B preview http://127.0.0.1:' + port + '/'));
