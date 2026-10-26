// @vitest-environment jsdom
import { afterEach, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import HousingEndNotice from '../HousingEndNotice';
afterEach(cleanup);
it('shows a linked proposal when the saved end date arrives, without changing residence',()=>{
  const biker={id:'b',name:'عامل تجريبي',residence:'سكن الشمال'};
  const page=render(<HousingEndNotice bikers={[biker]} today="2026-10-27" language="ar"/>);
  expect(screen.queryByText('اقتراحات إخلاء بعد نهاية العمل')).toBeNull();
  page.rerender(<HousingEndNotice bikers={[{...biker,endDate:'2026-10-27'}]} today="2026-10-27" language="ar"/>);
  expect(screen.getByRole('link',{name:'مراجعة اقتراح الإخلاء'}).getAttribute('href')).toBe('?page=housing#housing-%D8%B3%D9%83%D9%86%20%D8%A7%D9%84%D8%B4%D9%85%D8%A7%D9%84');
  expect(biker.residence).toBe('سكن الشمال');expect(screen.queryByRole('button')).toBeNull();
});
it('does not propose eviction for a future date, invalid date, or an already unlinked resident',()=>{
  render(<HousingEndNotice bikers={[{id:'future',endDate:'2026-11-01',residence:'سكن'},{id:'invalid',endDate:'2026-13-40',residence:'سكن'},{id:'unlinked',endDate:'2026-10-26',residence:''}]} today="2026-10-27" language="ar"/>);
  expect(screen.queryByRole('heading')).toBeNull();
});
