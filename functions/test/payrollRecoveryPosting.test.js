import {expect,it}from'vitest';
import {ADAPTERS as server}from'../src/posting.js';
import {ADAPTERS as client}from'../../src/lib/accounting/sourceAdapters.js';
it('salary-offset recoveries cannot create another cash/bank refund on either posting path',()=>{
 const row={status:'recovered',recovered_date:'2026-10-03',amount:90};
 expect(server.recovery.approved(row)).toBe(true);expect(client.recovery.isApproved(row)).toBe(true);
 expect(server.recovery.approved({...row,payroll_lock_id:'paid-run'})).toBe(false);expect(client.recovery.isApproved({...row,payroll_lock_id:'paid-run'})).toBe(false);
});
