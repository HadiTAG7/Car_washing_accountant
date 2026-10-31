// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import BikerDeductionFollowup from '../BikerDeductionFollowup';
import { LanguageContext } from '../../i18n/LanguageContext';
import { BIKER_DEDUCTION_TYPE, BIKER_DEDUCTION_AUTHORITY } from '../../lib/sweater/bikerDeductions';
const row=(id,bikerId,amountSAR)=>({id,bikerId,bikerName:`Test ${bikerId}`,recordType:BIKER_DEDUCTION_TYPE,status:'recorded',periodKey:'2026-10',metricKey:'cancelledByBiker',
  decisionReference:BIKER_DEDUCTION_AUTHORITY,unit:'count',quantity:1,amountSAR,event:{metricKey:'cancelledByBiker',bookingId:`C-${id}`,date:'2026-10-20',quantity:1,amount:amountSAR,reason:'Test saved reason'}});
afterEach(cleanup);
it.each(['ar','en'])('shows source and owner amounts separately, preserves null and never calls preview/save on read (%s)', language=>{
  const records=[row('101','A',129.95),row('102','A',null),row('103','B',129.95),row('104','C',129.95)];
  const before=JSON.stringify(records),preview=vi.fn(),save=vi.fn();
  render(<LanguageContext.Provider value={{language}}><BikerDeductionFollowup records={records} periodKey="2026-10" preview={preview} save={save}/></LanguageContext.Provider>);
  expect(screen.getByRole('table').textContent).toContain('149.95');
  const summary=screen.getByRole('region',{name:language==='ar'?'مبالغ متابعة الوقائع المسندة':'Assigned-event follow-up amounts'});
  expect(summary.textContent).toContain('409.85'); expect(summary.textContent).toContain('389.85');
  expect(summary.textContent).toContain(language==='ar'?'بقرار هادي، وليس مبلغًا فعليًا':'By Hadi’s decision, not an actual');
  expect(summary.textContent).toContain(language==='ar'?'ليست جميع إلغاءات':'not all Sweater cancellations');
  expect(summary.textContent).toContain(language==='ar'?'غير محدد من المصدر':'Not specified by source');
  expect(JSON.stringify(records)).toBe(before);expect(preview).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
it('does not turn a pending or failed month read into zero totals or an owner fallback',()=>{
  const view=render(<BikerDeductionFollowup records={[row('101','A',null)]} periodKey="2026-10" loading preview={vi.fn()} save={vi.fn()}/>);
  expect(screen.queryByRole('table')).toBeNull();expect(screen.getByText('جارٍ قراءة الوقائع المسندة…')).toBeTruthy();
  view.rerender(<BikerDeductionFollowup records={[row('101','A',null)]} periodKey="2026-10" readError={Error('test')} preview={vi.fn()} save={vi.fn()}/>);
  expect(screen.queryByRole('table')).toBeNull(); expect(screen.getByRole('alert').textContent).toContain('تعذّرت قراءة');
});
