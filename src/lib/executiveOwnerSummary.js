import { newerOperationsReview } from './latestOperationsReview.js';

// Presentation only: never rewrite the archived report or infer an approval.
export function readableExecutiveText(value = '') {
  return String(value)
    .replace(/sweater-hadi-alghanim(?:-[a-z0-9-]+)?\.vercel\.app/gi, 'app.hadialghanim.com')
    .replace(/([ء-ي])([0-9٠-٩])/gu, '$1 $2')
    .replace(/([0-9٠-٩])([ء-ي])/gu, '$1 $2')
    .replace(/([،؛؟!])(?=[^\s/])/gu, '$1 ')
    .replace(/:(?=[ء-ي])/gu, ': ')
    .replace(/\.(?=[ء-ي])/gu, '. ')
    .replace(/([ء-ي])\.(?=[0-9٠-٩])/gu, '$1. ')
    .replace(/([ء-ي])(?=(?:https?:\/\/)?app\.hadialghanim\.com)/gu, '$1 ')
    .replace(/([ء-ي])(Browser|HR|SSP|VAT|claim|End)\b/gu, '$1 $2')
    .replace(/\b(Browser|HR|SSP|VAT|claim|End)([ء-ي])/gu, '$1 $2')
    .trim();
}

function plainLanguage(value) {
  return readableExecutiveText(value)
    .replace(/(?:تطوير قدرة|تطوير تمثيل) مستند\/(?:بند|بنود)\/مجموع لحالتي\s*\d+\s*و\s*\d+/gu, 'تطوير تسجيل الفواتير متعددة البنود للفاتورتين المعلقتين')
    .replace(/داخل\s*(?:https?:\/\/)?app\.hadialghanim\.com/gu, '')
    .replace(/روابط أدلتها/gu, 'روابط الأدلة')
    .replace(/إرسال ملخص المراجعة المالية والأرصدة والحالات/gu, 'إرسال ملخص المالية والأرصدة والحالات')
    .replace(/\s+؟/gu, '؟');
}

export function executiveSentence(value, maxWords = 20) {
  const sentence = plainLanguage(value).split(/(?:[؛؟!]|\.(?!\d))/u)[0].trim();
  const words = sentence.split(/\s+/u).filter(Boolean);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(' ')}…` : sentence;
}

export function executiveOwnerDecisions(report) {
  if (!report) return [];
  const explicit = report.decisions.filter(d => d.status === 'awaiting_owner').flatMap(d => {
    const question = plainLanguage(d.next).match(/(?:^|\s)(?:و)?هل\s+[^؟]+؟/u)?.[0]?.trim();
    if (!question) return [];
    let reason = executiveSentence(d.decision);
    if (/قصور تمثيل بنود الأصل/u.test(d.decision)) reason = 'تسجيل الفواتير متعددة البنود غير مدعوم بالكامل.';
    if (/رفض.*إرسال التفاصيل المالية/u.test(d.decision)) reason = 'نقل التفاصيل المالية يحتاج موافقتك على البيانات والوجهة.';
    return [{ id: d.caseId, question: `${executiveSentence(question).replace(/^وهل/u, 'هل')}؟`, reason }];
  });
  if (explicit.length || !report.ownerAction.requiredAtCut) return explicit;
  // Older snapshots sometimes put questions only in the ownerAction paragraph.
  return [...plainLanguage(report.ownerAction.text).matchAll(/(?:^|\s)(?:و)?هل\s+[^؟]+؟/gu)].map((match, i) => ({
    id: `owner-${i}`, question: `${executiveSentence(match[0]).replace(/^وهل/u, 'هل')}؟`,
    reason: 'السبب التفصيلي غير مفصول في التقرير؛ راجع النص المحفوظ أدناه.',
  }));
}

export function executiveProblems(report, cash = {}, operations) {
  const problems = [];
  if (cash.error) problems.push({ id: 'cash-read', severity: 'open', text: 'تعذرت قراءة أرصدة الحسابات النقدية؛ لا يمكن تأكيد الرصيد الحالي.', current: true });
  else if (!cash.loading && cash.balances?.some(row => row.balance < 0)) problems.push({
    id: 'negative-cash', severity: 'critical', current: true,
    text: 'رصيد نقدي سالب يحتاج مراجعة:', balances: cash.balances.filter(row => row.balance < 0),
  });
  const newer = newerOperationsReview(operations, report);
  if (newer && (operations.report.status !== 'reviewed' || Object.values(operations.report.coverage).some(c => c.status !== 'verified')
    || operations.report.metrics.some(m => m.basis === 'unavailable') || operations.report.cases.some(c => c.status !== 'verified_closed'))) problems.push({
    id: 'operations', severity: 'open', operations: operations.report,
    text: 'تغطية التشغيل جزئية؛ راجع النطاق والفجوات أدناه.', current: false,
  });
  const seen = new Set();
  const warnings = [...(report?.visibleWarnings || [])].sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1));
  for (const warning of warnings) {
    let key, text;
    if (/تشغيل.*غير مقروء|أيام.*مفقودة/u.test(warning.text)) {
      if (newer) continue;
      key = 'operations'; text = 'بيانات التشغيل غير مكتملة؛ الأرقام التشغيلية في التقرير تحتاج تحديثًا.';
    } else if (/حد الاستخدام|جولات|أداة|أحداث|504|المراجعة الآلية/u.test(warning.text)) continue;
    else if (/جودة|النجوم|النهائي.*غير مكتمل/u.test(warning.text)) {
      key = 'quality'; text = 'تقييم الجودة غير مكتمل؛ لا تعتمد عليه لتقييم جميع البايكرز.';
    } else if (/الصندوق|البنك/u.test(warning.text)) continue; // Current ledger, not archived cash figures, governs the alert.
    else { key = warning.id; text = executiveSentence(warning.text); }
    if (!text || seen.has(key)) continue;
    seen.add(key); problems.push({ id: key, severity: warning.severity, text, current: false });
  }
  return problems.slice(0, 3);
}
