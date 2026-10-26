// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import VatFilingOverview from '../VatFilingOverview';
import {TAX_FILING_REPORT_ID} from '../../lib/vatDashboard';
const read=vi.hoisted(()=>({allowed:true,loading:false,error:null,data:null}));
vi.mock('../../hooks/useFinanceRead',()=>({useFinanceRead:()=>read}));
afterEach(cleanup);
const settings={vatRegistered:true,vatRate:.15,vatFilingPeriod:'quarterly',washPriceMode:'inclusive',taxPolicyHistory:[{effectiveFrom:'2026-05-01',vatRegistered:true,vatRate:.15,washPriceMode:'inclusive'}]};
const props={settings,today:'2026-10-26',ready:true,sources:{inputs:[],washes:[],entries:[],lines:[],settlements:[]}};
it('shows reported Q3 submission and upcoming Q4 without silently marking Q2 filed or overdue',()=>{
  read.data={report:{reportId:TAX_FILING_REPORT_ID,sourceRole:3,dateRiyadh:'2026-10-24',visibleWarnings:[{id:'historical-q3',text:'65011830763'}],cases:[{caseId:'TAX-Q3-FILED-CREDIT-PRESENTATION-20261015'}]}};
  render(<VatFilingOverview {...props}/>);
  expect(screen.getByRole('status').textContent).toContain('الربع الرابع 2026');
  expect(screen.getByRole('status').textContent).toContain('97');
  expect(screen.getByText('مقدّم حسب تقرير وكيل الضرائب')).toBeTruthy();
  expect(screen.getByText('65011830763')).toBeTruthy();
  expect(screen.getByText(/بانتظار تأكيد هادي · تقرير/)).toBeTruthy();
  expect(screen.getByText('حالة التقديم غير موثقة')).toBeTruthy();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});
it('does not label a missing report as a confirmed unfiled Q3 or manufacture zero while loading data',()=>{
  read.error='تعذر القراءة';read.data=null;
  render(<VatFilingOverview {...props} ready={false}/>);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('لا يُفترض');
  const rows=within(screen.getByRole('table')).getAllByRole('row');
  expect(rows[2].textContent).toContain('حالة التقديم غير موثقة');
  expect(rows[2].textContent).toContain('غير متاح');
  expect(rows[2].textContent).not.toContain('0.00');
  read.error=null;
});
