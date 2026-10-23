import { createRoot } from 'react-dom/client';
import SweaterHandoffPreview from '../../src/components/SweaterHandoffPreview';
import { completionFixture } from '../../functions/test/administrativeCompletionFixture';
import '../../src/index.css';
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<main className="p-4"><p>بيانات اصطناعية فقط — لا اتصال بالإنتاج</p><details><summary>ملف اختبار اصطناعي للنسخ</summary><pre dir="ltr">{JSON.stringify(completionFixture(),null,2)}</pre></details><SweaterHandoffPreview/><output id="fixture-action"/></main>);
