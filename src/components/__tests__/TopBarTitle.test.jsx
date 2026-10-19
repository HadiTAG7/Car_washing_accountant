// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TopBar from '../TopBar';
vi.mock('../../hooks/useAuth',()=>({useAuth:()=>({session:null})}));
vi.mock('../../hooks/useDarkMode',()=>({useDarkMode:()=>({darkMode:false,toggle:vi.fn()})}));
vi.mock('../../contexts/MobileMenuContext',()=>({useMobileMenu:()=>({open:false,toggle:vi.fn(),desktopHidden:false,toggleDesktop:vi.fn()})}));
vi.mock('../AdminPartnerSelector',()=>({default:()=>null}));
vi.mock('../LanguageSwitcher',()=>({default:()=>null}));
afterEach(cleanup);
it('opts into a fully wrapping executive heading without changing other page headings',()=>{
  const view=render(<TopBar title="الداش بورد التنفيذي" wrapTitle/>);
  expect(screen.getByRole('heading',{level:1}).textContent).toBe('الداش بورد التنفيذي');
  expect(screen.getByRole('heading',{level:1}).classList.contains('truncate')).toBe(false);
  expect(screen.getByRole('heading',{level:1}).classList.contains('whitespace-normal')).toBe(true);
  view.rerender(<TopBar title="صفحة أخرى"/>);
  expect(screen.getByRole('heading',{level:1}).classList.contains('truncate')).toBe(true);
});
