// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import BikerWashCalendar from '../BikerWashCalendar';

afterEach(cleanup);
const props = () => ({ periodKey: '2026-10', today: '2026-10-14', language: 'ar', available: true,
  daily: [{ date: '2026-10-13', count: 5 }, { date: '2026-10-14', count: 0 }] });

it('aligns the first day with Thursday, pads complete weeks and renders every date once', () => {
  render(<BikerWashCalendar {...props()} />);
  const table = screen.getByRole('table', { name: 'تقويم الغسلات اليومية' });
  expect(table.querySelectorAll('time')).toHaveLength(31);
  expect(table.querySelector('tbody tr').children[4].getAttribute('data-date')).toBe('2026-10-01');
  expect([...table.querySelectorAll('tbody tr')].every(row => row.children.length === 7)).toBe(true);
  expect(new Set([...table.querySelectorAll('time')].map(t => t.dateTime)).size).toBe(31);
  expect(table.parentElement.getAttribute('dir')).toBe('rtl');
});
it('shows confirmed counts including zero, and marks today accessibly', () => {
  render(<BikerWashCalendar {...props()} />);
  expect(screen.getByLabelText('2026-10-13: 5 غسلات مسجلة').textContent).toBe('5');
  expect(screen.getByLabelText('2026-10-14: 0 غسلات مسجلة').textContent).toBe('0');
  expect(document.querySelector('time[aria-current="date"]').dateTime).toBe('2026-10-14');
  expect(screen.getByText('اليوم')).toBeTruthy();
});
it('does not invent zeros outside the worker period or in future days', () => {
  render(<BikerWashCalendar {...props()} />);
  expect(screen.getByLabelText('2026-10-01: خارج فترة العامل').textContent).toBe('—');
  expect(screen.getByLabelText('2026-10-15: يوم قادم').textContent).toBe('—');
});
it('does not display counts from an unavailable source', () => {
  render(<BikerWashCalendar {...props()} available={false} />);
  expect(screen.getByLabelText('2026-10-13: غير متاح').textContent).toBe('—');
  expect(document.querySelectorAll('td[data-state="recorded"]')).toHaveLength(0);
});
it.each([['2024-02', 29], ['2025-02', 28], ['2026-04', 30]])('uses the actual number of days in %s', (periodKey, days) => {
  render(<BikerWashCalendar {...props()} periodKey={periodKey} />);
  expect(document.querySelectorAll('time')).toHaveLength(days);
});
it('renders English month and weekdays left-to-right', () => {
  render(<BikerWashCalendar {...props()} language="en" />);
  const table = screen.getByRole('table', { name: 'Daily wash calendar' });
  expect(table.caption.textContent).toBe('October 2026');
  expect([...table.querySelectorAll('th')].map(th => th.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  expect(table.parentElement.getAttribute('dir')).toBe('ltr');
});
it('rejects an invalid period instead of rendering malformed dates', () => {
  render(<BikerWashCalendar {...props()} periodKey="2026-99" />);
  expect(screen.queryByRole('table')).toBeNull();
});
it.each(['ar', 'en'])('removes only the visible calendar note while preserving accessible day states (%s)', language => {
  render(<BikerWashCalendar {...props()} language={language} />);
  expect(document.querySelector('.sw-biker-calendar-wrap > p')).toBeNull();
  expect(screen.getByLabelText(language === 'ar' ? '2026-10-13: 5 غسلات مسجلة' : '2026-10-13: 5 recorded washes').textContent).toBe('5');
  expect(screen.getByLabelText(language === 'ar' ? '2026-10-15: يوم قادم' : '2026-10-15: Future day').textContent).toBe('—');
});
