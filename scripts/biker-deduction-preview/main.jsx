import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import BikerDeductionFollowup from '../../src/components/BikerDeductionFollowup';
import { BIKER_DEDUCTION_AUTHORITY } from '../../src/lib/sweater/bikerDeductions';
import '../../src/index.css';
import '../../src/components/QualityViolationsPage.css';
document.documentElement.classList.add('dark');
async function call(op, input) {
  const result = await fetch('/__isolated-biker-deduction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, input }) }).then(r => r.json());
  if (result.error) throw Error(result.error); return result.result;
}
export function Fixture() {
  const [records, setRecords] = useState([]);
  return <main className="qv-page"><p>اختبار اصطناعي معزول — لا اتصال بالإنتاج أو سويتر</p>
    <details><summary>ملف اصطناعي للنسخ</summary><pre id="fixture-json" dir="ltr">{JSON.stringify({ sourceKind: 'booking', periodKey: '2026-10', metricKey: 'cancelledByBiker',
      sourceId: 'C-990002', snapshotId: 'raw-test-run', bikerId: 'worker-one', expectedRevision: 0, reason: 'Synthetic reviewed reason', decisionReference: BIKER_DEDUCTION_AUTHORITY }, null, 2)}</pre></details>
    <BikerDeductionFollowup records={records} preview={input => call('preview', input)} save={async input => {
      const result = await call('save', input), readback = await call('read', { id: result.id });
      if (readback.record.revision !== result.record.revision) throw Error('Synthetic readback mismatch');
      setRecords(await call('list', {})); return { ...result, readbackVerified: true };
    }} /></main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
