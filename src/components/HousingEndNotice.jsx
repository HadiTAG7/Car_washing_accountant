import { Card } from './UI';
import { displayBikerName } from '../lib/bikerNames';
import { housingInactive } from '../lib/housingOverview';

/** Derived notice: saving an end date never writes residence. */
export default function HousingEndNotice({ bikers, today, language }) {
  const proposals = bikers.filter(b => b.endDate && b.residence && housingInactive({endDate:b.endDate},today));
  if (!proposals.length) return null;
  return <Card className="p-4 space-y-2 border-amber-300 dark:border-amber-700">
    <h2 className="font-bold">اقتراحات إخلاء بعد نهاية العمل</h2>
    <p className="text-sm">تاريخ النهاية لا يلغي ربط السكن. راجع كل اقتراح وأكّد الإخلاء من صفحة السكن.</p>
    <ul className="space-y-2 text-sm">{proposals.map(b => <li key={b.id} className="flex flex-wrap gap-2 justify-between">
      <span>{displayBikerName(b,language)} · {b.residence} · {b.endDate}</span>
      <a className="underline text-primary-700 dark:text-primary-300" href={`?page=housing#housing-${encodeURIComponent(b.residence)}`}>مراجعة اقتراح الإخلاء</a>
    </li>)}</ul>
  </Card>;
}
