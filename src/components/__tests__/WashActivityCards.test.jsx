// @vitest-environment jsdom
import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import WashActivityCards from '../WashActivityCards';
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open',''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);
const items = [{washDate:'2026-10-18',quantity:3,price:20,status:'مكتملة'},
  {washDate:'2026-10-17',quantity:2,price:25,status:'مكتملة'}];
it('opens daily counts from the latest-day card and returns keyboard focus on close', () => {
  render(<WashActivityCards items={items} />);
  expect(screen.queryByText('غسلات أمس')).toBeNull();
  const trigger = screen.getByRole('button',{name:'عرض الغسلات اليومية'});
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('heading').textContent).toBe('الغسلات اليومية');
  expect(within(dialog).getAllByRole('row')).toHaveLength(4);
  expect(within(dialog).getByRole('columnheader',{name:'عدد الغسلات'})).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button',{name:'إغلاق التفاصيل'}));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it('opens daily revenue using existing loaded data without a new network request', () => {
  const fetch = vi.spyOn(globalThis,'fetch');
  render(<WashActivityCards items={items} />);
  fireEvent.click(screen.getByRole('button',{name:'عرض الإيرادات اليومية'}));
  const rows = within(screen.getByRole('dialog')).getAllByRole('row');
  expect(rows[1].textContent).toContain('60.00');
  expect(rows[2].textContent).toContain('50.00');
  expect(rows[3].textContent).toContain('110.00');
  expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
});
it.each([{loading:true},{error:new Error('offline')}])('does not show successful zero results while source is unavailable: %o', state => {
  render(<WashActivityCards items={[]} {...state} />);
  expect(screen.getByRole('button',{name:'عرض الغسلات اليومية'}).disabled).toBe(true);
  expect(screen.getByRole('button',{name:'عرض الإيرادات اليومية'}).disabled).toBe(true);
  expect(screen.getAllByText('—')).toHaveLength(3);
});
it('handles a valid empty register and cancels the native dialog', () => {
  render(<WashActivityCards items={[]} />);
  fireEvent.click(screen.getByRole('button',{name:'عرض الغسلات اليومية'}));
  expect(screen.getByText('لا توجد غسلات مكتملة في السجل المحمّل.')).toBeTruthy();
  fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true,cancelable:true}));
  expect(screen.queryByRole('dialog')).toBeNull();
});
