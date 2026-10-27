import React from 'react';
import { createRoot } from 'react-dom/client';
import FinanceWorkbenchPage from '../../src/components/FinanceWorkbenchPage';
import '../../src/index.css';

export default function IsolatedWorkbench() {
  return <><p style={{ padding: 16 }}>اختبار معزول ببيانات مصطنعة — لا اتصال بالإنتاج.</p><FinanceWorkbenchPage /></>;
}
createRoot(document.getElementById('root')).render(<IsolatedWorkbench />);
