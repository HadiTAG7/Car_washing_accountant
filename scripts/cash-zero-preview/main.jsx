import {createRoot} from 'react-dom/client';
import CashResidualCorrections from '../../src/components/CashResidualCorrections';
import '../../src/index.css';
document.documentElement.classList.add('dark');
export default function Preview(){return <main className="p-6 max-w-5xl mx-auto"><h1 className="mb-6">معاينة اصطناعية — قاعدة محلية مستقلة، بلا إنتاج</h1><CashResidualCorrections/></main>;}
createRoot(document.getElementById('root')).render(<Preview/>);
