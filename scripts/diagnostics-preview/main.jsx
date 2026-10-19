import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AppErrorBoundary from '../../src/components/AppErrorBoundary.jsx';
import '../../src/index.css';

export function SyntheticPage() {
  const [failed, setFailed] = useState(false);
  if (failed) throw new TypeError("Cannot read properties of undefined (reading 'SYNTHETIC_PRIVATE')");
  return createElement('button', { type: 'button', onClick: () => setFailed(true) }, 'اختبار تعطل العرض');
}
createRoot(document.getElementById('root')).render(createElement('main', { className: 'sw-recovery-card' },
  createElement('h1', null, 'اختبار محلي معزول — لا اتصال ببيانات الشركة'),
  createElement('label', null, 'مسودة تجريبية غير محفوظة', createElement('input', { 'aria-label': 'مسودة تجريبية غير محفوظة', defaultValue: 'SYNTHETIC_UNSAVED_DRAFT', style: { display: 'block', width: '100%', color: '#111', background: '#fff' } })),
  createElement(AppErrorBoundary, null, createElement(SyntheticPage)),
));
window.SweaterRecovery?.ready();
