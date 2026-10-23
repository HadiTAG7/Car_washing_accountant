import { financeFixture, memoryFinanceDb } from './financeFixtures.js';
import { financeReportId, parseFinanceReport } from '../../src/lib/financeReportContract.js';
import { FINANCE_NUMBER_ROWS } from '../../src/lib/financeReportPresentation.js';

export function financeReportViewFixture(day = 22, role = 1, numbers = 'complete') {
  const date = `2026-10-${String(day).padStart(2, '0')}`, cut = `${date}T23:00:00+03:00`;
  const report = financeFixture({ dateRiyadh: date, cutAtRiyadh: cut, sourceRole: role, period: { kind: 'daily', from: date, to: date },
    title: 'المالية — المستند14 والمتابعة الداخلية', summary: 'صححناالمستند14ب140ريال؛الصندوقسالب. هذا نص اصطناعي لا يمثل الشركة.' });
  report.reportId = financeReportId(report); report.review.at = cut; report.review.reviewerRole = role;
  report.sources[0].checkedAt = cut; report.sources[0].sourceRef = 'https://app.hadialghanim.com/?page=finance';
  report.metrics = numbers === 'none' ? [] : FINANCE_NUMBER_ROWS.filter(row => numbers !== 'partial' || /ledger$/.test(row.id)).map(row => ({ id: row.id, label: row.label, value: ({ 'monthly-revenue': 1234, 'monthly-expenses': 1567,
    'monthly-result': -333, 'bank-ledger': 5500 + day, 'cash-ledger': -50 - day, 'monthly-vat-net': 77 })[row.id],
    unit: 'ريال', basis: row.basis, coverage: 'لقطة اصطناعية من صفحات الموقع، 2026-10 — لا إنتاج', asOf: cut }));
  report.visibleWarnings = [
    { id: 'small', severity: 'open', text: 'المستند14 بمبلغ140ريال يحتاج دليلًا. مثال اصطناعي.' },
    { id: 'capital', severity: 'open', text: 'فرق رأس المال بمبلغ12000ريال يحتاج مطابقة. مثال اصطناعي.' },
    { id: 'supplier', severity: 'open', text: 'فاتورة مورد بمبلغ2400ريال تحتاج مراجعة. مثال اصطناعي.' },
    { id: 'tools', severity: 'limitation', text: 'أداة4 وحد الاستخدام في سجل الاختبار فقط.' },
  ];
  report.cases = [
    { caseId: 'TEST-OWNER-A', title: 'خطة مطابقة تمويل المشروع', ownerRole: 1, status: 'awaiting_owner', evidence: 'قرار اصطناعي فقط؛ لا ينفذ تمويلًا.', next: 'هل تعتمد خطة مطابقة تمويل المشروع؟' },
    { caseId: 'TEST-OWNER-B', title: 'مطابقة البنك', ownerRole: 1, status: 'awaiting_owner', evidence: 'بيانات اصطناعية، لا معاملة.', next: 'هل توافق على خطة مطابقة البنك؟' },
  ];
  return parseFinanceReport(report);
}
export function financeReportViewDb() {
  const db = memoryFinanceDb({ 'users/test-admin': { role: 'admin' } });
  for (let role = 1; role <= 3; role++) for (let day = 1; day <= 22; day++) {
    const report = financeReportViewFixture(day, role, role === 1 ? day === 21 ? 'partial' : 'complete' : 'none');
    if (day === 1 && role === 3) report.sections[0].text = 'علامة بحث نادرة — المستند14';
    db.rows.set(`finance_reports/${report.reportId}`, report);
    db.rows.set(`finance_reports/${report.reportId}/revisions/000001`, { reportJson: JSON.stringify(report), revision: 1 });
  }
  return db;
}
