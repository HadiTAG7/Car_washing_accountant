// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TopBar from '../TopBar';
import { MobileMenuProvider } from '../../contexts/MobileMenuContext';
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ session: null }) }));
vi.mock('../../hooks/useDarkMode', () => ({ useDarkMode: () => ({ darkMode: false, toggle: vi.fn() }) }));
vi.mock('../AdminPartnerSelector', () => ({ default: () => null }));
vi.mock('../LanguageSwitcher', () => ({ default: () => null }));
afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.dir = 'rtl'; });
it.each(['rtl', 'ltr'])('keeps the restoring control beside the right-hand rail in %s, with the same persisted behavior', dir => {
  document.documentElement.dir = dir;
  render(<MobileMenuProvider><TopBar title="عنوان الصفحة" /></MobileMenuProvider>);
  const title = screen.getByRole('heading', { level: 1 });
  const hide = screen.getByRole('button', { name: 'إخفاء القائمة الجانبية' });
  expect(hide.closest('[dir]').dir).toBe('rtl');
  expect(hide.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(hide.getAttribute('aria-controls')).toBe('app-sidebar');
  fireEvent.click(hide);
  const show = screen.getByRole('button', { name: 'إظهار القائمة الجانبية' });
  expect(show.getAttribute('aria-expanded')).toBe('false');
  expect(localStorage.getItem('sweater:sidebar-hidden')).toBe('true');
  fireEvent.click(show);
  expect(screen.getByRole('button', { name: 'إخفاء القائمة الجانبية' }).getAttribute('aria-expanded')).toBe('true');
  expect(localStorage.getItem('sweater:sidebar-hidden')).toBe('false');
});
it('keeps mobile drawer state independent of desktop visibility', () => {
  render(<MobileMenuProvider><TopBar title="المالية" /></MobileMenuProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'إخفاء القائمة الجانبية' }));
  fireEvent.click(screen.getByRole('button', { name: 'فتح القائمة' }));
  expect(screen.getByRole('button', { name: 'إغلاق القائمة' }).getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('button', { name: 'إظهار القائمة الجانبية' }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'إغلاق القائمة' }));
  expect(screen.getByRole('button', { name: 'فتح القائمة' }).getAttribute('aria-expanded')).toBe('false');
});
