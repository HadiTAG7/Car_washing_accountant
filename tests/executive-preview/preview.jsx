import FinanceReportOverview from '../../src/components/FinanceReportOverview';
import { financeFixture } from '../../server/__tests__/financeFixtures';
import { financialPreviewSnapshot } from './financialFixture';
import '../../src/components/FinanceReportsPage.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import ExecutiveDailySummary from '../../src/components/ExecutiveDailySummary';
import { publishedQualityReview } from '../../src/lib/executiveQualityReview';
import { executiveFixture } from '../../server/__tests__/executiveFixture';
import { operationsFixture } from '../../server/__tests__/operationsFixture';
import '../../src/index.css';
import '../../src/components/ExecutiveReportsPage.css';

const report = executiveFixture({ dateRiyadh: '2026-10-22', cutAtRiyadh: '2026-10-22T23:00:00+03:00',
  visibleWarnings: [{ id: 'quality-old', severity: 'open', text: 'الجودة غير مكتملة في التقرير المحفوظ القديم.' }] });
const data = { today: '2026-10-26', cash: { loading: false, balances: [{ code: '1010', name: 'صندوق اختبار', balance: -120 }] } };
const saved = { id: 'TEST-PUBLISHED', bikerUID: 'TEST-A', periodKey: '2026-10', rulesVersion: 'cqo-20261015-v3',
  from: '2026-10-01', to: '2026-10-19', sourceReadDate: '2026-10-20', snapshotAt: '2026-10-20T08:02:57Z', createdAt: '2026-10-20T08:08:13Z',
  contentHash: 'a'.repeat(64), status: 'incomplete', finalScore: null, components: [{ key: 'duration', weight: 10, points: 8, n: 20 }],
  coverage: { criteria: { duration: true } } };
const current = { ...saved, id: 'TEST-NEWER', to: '2026-10-25', sourceReadDate: '2026-10-26', snapshotAt: '2026-10-26T06:00:00Z', createdAt: '2026-10-26T07:00:00Z' };
const states = {
  old: { review: publishedQualityReview([{ id: 'TEST-A' }, { id: 'TEST-B' }], [{ bikerUID: 'TEST-A', data: { reports: [saved], source: { available: true } } }], '2026-10', data.today) },
  newer: { review: publishedQualityReview([{ id: 'TEST-A' }], [{ bikerUID: 'TEST-A', data: { reports: [saved, current], source: { available: true } } }], '2026-10', data.today) },
  unavailable: { error: 'تعذرت قراءة تقارير الجودة المنشورة؛ لا يمكن تأكيد الحالة الحالية.' }, loading: { loading: true },
};
export default function Preview() {
  const [state, setState] = useState('old');
  const [page, setPage] = useState('finance');
  const snapshot = state === 'unavailable' ? undefined : state === 'failed' ? {...financialPreviewSnapshot, metrics: financialPreviewSnapshot.metrics.map(m=>({...m,value:null,basis:'unavailable'}))} : financialPreviewSnapshot;
  const notes = [{id:'test-note',severity:'open',text:'قراءة 24 أكتوبر تعيد policyUnconfigured=true و ledgerInput/Output'}];
  return <main className="sw-executive-page" dir="rtl"><p>معاينة اختبار معزولة · بيانات وهمية · لا اتصال بالإنتاج</p>
    <label>الصفحة<select value={page} onChange={e=>setPage(e.target.value)}><option value='finance'>تقارير المالية</option><option value='executive'>التقرير التنفيذي</option></select></label><label>حالة اختبار الجودة<select value={state} onChange={e => setState(e.target.value)}><option value="old">منشور قديم جزئي</option><option value="newer">منشور أحدث جزئي</option><option value="unavailable">قراءة غير متاحة</option><option value="loading">جارٍ التحميل</option><option value="failed">تعذرت الأرقام وقت الحفظ</option></select></label>
    {page === 'finance' ? <FinanceReportOverview report={financeFixture({financialSnapshot:snapshot,visibleWarnings:notes})}/> : <ExecutiveDailySummary report={{...report,financialSnapshot:snapshot,visibleWarnings:notes}} data={data} operationsReview={{ report: operationsFixture(), loading: false }} qualityReview={states[state]} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview />);
