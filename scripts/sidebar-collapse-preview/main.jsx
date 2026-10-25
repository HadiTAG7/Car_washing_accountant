import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import Sidebar from '../../src/components/Sidebar';
import {visibleGroupsFor} from '../../src/lib/navGroups';
import '../../src/index.css';
document.documentElement.classList.add('dark');
export default function Preview(){
  const [active,setActive]=useState('finance');
  return <><Sidebar groups={visibleGroupsFor({role:'admin'})} activeTab={active} onSelectTab={setActive} mobileOpen user={{email:'preview@example.test'}}/>
    <main className="p-8 mr-72"><h1>معاينة قائمة اصطناعية — {active}</h1></main></>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
