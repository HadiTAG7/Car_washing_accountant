// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BikerProfileMonthPicker from '../BikerProfileMonthPicker';

afterEach(cleanup);
const props = () => ({ value: '2026-10', max: '2026-10', language: 'ar', onChange: vi.fn() });
it('renders month names in the app language without native month inputs', () => {
  render(<BikerProfileMonthPicker {...props()} />);
  expect(screen.getByRole('button', { name: 'الشهر' }).textContent).toContain('أكتوبر');
  expect(document.querySelector('input')).toBeNull();
});
it('chooses a valid month, disables future months and returns focus to trigger', () => {
  const p = props(); render(<BikerProfileMonthPicker {...p} />);
  const trigger = screen.getByRole('button', { name: 'الشهر' });
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: 'نوفمبر 2026' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'السنة التالية' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'سبتمبر 2026' }));
  expect(p.onChange).toHaveBeenCalledWith('2026-09');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it('changes year without changing selected period until a month is picked', () => {
  const p = props(); render(<BikerProfileMonthPicker {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'الشهر' }));
  fireEvent.click(screen.getByRole('button', { name: 'السنة السابقة' }));
  expect(p.onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'فبراير 2025' }));
  expect(p.onChange).toHaveBeenCalledWith('2025-02');
});
it('dismisses with Escape or outside pointer without changing period', () => {
  const p = props(); render(<BikerProfileMonthPicker {...p} />);
  const trigger = screen.getByRole('button', { name: 'الشهر' });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(p.onChange).not.toHaveBeenCalled();
});
it('renders English controls and focuses the selected month', () => {
  render(<BikerProfileMonthPicker {...props()} language="en" />);
  fireEvent.click(screen.getByRole('button', { name: 'Month' }));
  expect(screen.getByRole('dialog', { name: 'Choose month' }).parentElement.dir).toBe('ltr');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'October 2026' }));
});
