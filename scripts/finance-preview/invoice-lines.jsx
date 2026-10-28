// Dedicated entry keeps unrelated finance pages and their remote hooks outside
// this local-only workbench harness. Requests are aliased to memory storage.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import FinanceWorkbenchPage from '../../src/components/FinanceWorkbenchPage';
import FinanceExpenseForm, { ChangePreview } from '../../src/components/FinanceExpenseForm';
import { callFinanceApi } from './workbench-flow';
import '../../src/index.css';

// Optional read-only initial views avoid relying on a browser tool's ability to
// select another row. They use actual read/preview responses from the same
// isolated handler, never DOM injection, a forged protected flag, or live data.
export function InitialScenario({ mode }) {
  const [revision, setRevision] = useState(0), [state, setState] = useState(null), [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      let source;
      if (mode === 'protected') source = { kind: 'startup', sourceId: 'synthetic-corrected-source' };
      else if (mode === 'reviewed-partial' || mode === 'reviewed-partial-comparison') source = { kind: 'startup', sourceId: 'c790RQ8Dk5q8RoX3K3dO' };
      else if (mode === 'quantity' || mode === 'exception-comparison') source = { kind: 'startup', sourceId: 'I8tWV7ElQXRMW3AFMqBI' };
      else if (mode === 'allocation' || mode === 'allocation-comparison') source = { kind: 'startup', sourceId: 'xm8IA2ypXnQvQ7LFLPTy' };
      else if (mode === 'allocation-peer') source = { kind: 'startup', sourceId: 'zk0wmq8nHTbsgs9CteWd' };
      else {
        const list = await callFinanceApi('finance-workbench', { action: 'browse' });
        const target = mode === 'shared' ? 'TEST-SHARED-LINES' : 'TEST-MIXED-LINES';
        source = mode === 'status' ? list.items.find(item => item.title.includes('TEST-SAVED-PENDING')) : list.items.find(item => item.documentNumber === target);
        if (!source) throw new Error('Isolated scenario source not found');
      }
      const detail = await callFinanceApi('finance-workbench', { action: 'read', kind: source.kind, sourceId: source.sourceId });
      const options = await callFinanceApi('finance-workbench', { action: 'options', kind: source.kind });
      if (mode === 'protected' && !detail.protectedSource) throw new Error('Isolated protected-source evidence did not match');
      let preview = null;
      if (mode === 'reviewed-partial-comparison') preview = await callFinanceApi('finance-workbench', { action: 'preview', kind: source.kind, sourceId: source.sourceId, sourceHash: detail.sourceHash, patch: {} });
      if (mode === 'comparison') {
        const invoiceLines = structuredClone(detail.row.finance_metadata.invoiceLines);
        invoiceLines.items[0].quantity *= 2; invoiceLines.items[0].unitCost /= 2;
        preview = await callFinanceApi('finance-workbench', { action: 'preview', kind: source.kind, sourceId: source.sourceId,
          sourceHash: detail.sourceHash, patch: { invoiceLines } });
      }
      if (mode === 'exception-comparison' || mode === 'allocation-comparison') {
        const field = mode === 'exception-comparison' ? 'quantityException' : 'documentAllocation';
        const grant = field === 'quantityException' ? detail.sourceContext.quantityGrant : detail.sourceContext.allocationGrant;
        preview = await callFinanceApi('finance-workbench', { action: 'preview', kind: source.kind, sourceId: source.sourceId,
          sourceHash: detail.sourceHash, patch: { [field]: { version: 1, grantRef: grant.ref, sourceRef: 'TEST synthetic reviewed evidence only' } } });
      }
      if (active) setState({ source, detail, preview, options });
    })().catch(error => { if (active) setState({ error: error.message }); });
    return () => { active = false; };
  }, [mode, revision]);
  return <main className="fw-page fw-workbench"><article className="fw-panel">
    {!state ? <p role="status">جارٍ قراءة سيناريو الاختبار...</p> : state.error ? <p role="alert">{state.error}</p>
      : state.preview ? <ChangePreview kind={state.source.kind} preview={state.preview} options={[]} />
        : <FinanceExpenseForm key={state.detail.sourceHash} kind={state.source.kind} detail={state.detail}
          options={{ loading: false, data: state.options }} onMessage={setMessage} onSaved={() => setRevision(value => value + 1)} />}
    {message && <p role="status">{message}</p>}
  </article></main>;
}
const requested = new URLSearchParams(window.location.search).get('view');
createRoot(document.getElementById('root')).render(<>
  <header style={{ padding: 16, borderBottom: '3px solid #d97706' }}>
    <strong>اختبار معزول — بيانات اصطناعية في الذاكرة فقط، دون اتصال بالإنتاج</strong>
  </header>
  {['protected', 'comparison', 'shared', 'quantity', 'exception-comparison', 'allocation', 'allocation-peer', 'allocation-comparison', 'status', 'reviewed-partial', 'reviewed-partial-comparison'].includes(requested) ? <InitialScenario mode={requested} /> : <FinanceWorkbenchPage />}
</>);
