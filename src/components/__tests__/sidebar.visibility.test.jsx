// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MobileMenuProvider, useMobileMenu } from '../../contexts/MobileMenuContext';
import Sidebar from '../Sidebar';
import TopBar from '../TopBar';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ session: null }) }));
vi.mock('../AdminPartnerSelector', () => ({ default: () => null }));

function Navigation() {
  const menu = useMobileMenu();
  return <><Sidebar desktopHidden={menu.desktopHidden} mobileOpen={menu.open} onCloseMobile={() => menu.setOpen(false)} />
    <TopBar title="اختبار القائمة" /></>;
}
const mount = () => render(<MobileMenuProvider><Navigation /></MobileMenuProvider>);
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it('hides and restores the desktop rail while keeping its toggle focused and reachable', () => {
  mount();
  const toggle = screen.getByRole('button', { name: 'إخفاء القائمة الجانبية' });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.getAttribute('aria-controls')).toBe(document.querySelector('aside').id);
  toggle.focus(); fireEvent.click(toggle);
  expect(document.querySelector('aside').classList.contains('md:hidden')).toBe(true);
  expect(screen.getByRole('button', { name: 'إظهار القائمة الجانبية' }).getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(toggle);
  fireEvent.click(toggle);
  expect(document.querySelector('aside').classList.contains('md:hidden')).toBe(false);
});

it('remembers desktop hiding after the shell mounts again', () => {
  const view = mount();
  fireEvent.click(screen.getByRole('button', { name: 'إخفاء القائمة الجانبية' }));
  view.unmount(); mount();
  expect(screen.getByRole('button', { name: 'إظهار القائمة الجانبية' })).toBeTruthy();
  expect(document.querySelector('aside').classList.contains('md:hidden')).toBe(true);
});

it('keeps mobile opening independent of the desktop preference', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'إخفاء القائمة الجانبية' }));
  const mobile = screen.getByRole('button', { name: 'فتح القائمة', exact: true });
  fireEvent.click(mobile);
  expect(mobile.getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('aside').classList.contains('translate-x-0')).toBe(true);
  fireEvent.click(mobile);
  expect(mobile.getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('button', { name: 'إظهار القائمة الجانبية' })).toBeTruthy();
});

it('still toggles when browser storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'إخفاء القائمة الجانبية' }));
  expect(screen.getByRole('button', { name: 'إظهار القائمة الجانبية' })).toBeTruthy();
});
