// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import RouteMounted from '../RouteMounted';
import AppErrorBoundary from '../AppErrorBoundary';
afterEach(() => { cleanup(); delete window.SweaterRecovery; vi.restoreAllMocks(); });
it('only clears a notice after a successful page commit, not a thrown page', () => {
  const routeReady = vi.fn(); window.SweaterRecovery = { routeReady };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function Broken() { throw new Error('Synthetic render failure'); }
  render(<AppErrorBoundary><Suspense fallback="loading"><RouteMounted page="finance_workbench" /><Broken /></Suspense></AppErrorBoundary>);
  expect(routeReady).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeTruthy(); cleanup();
  render(<AppErrorBoundary><Suspense fallback="loading"><RouteMounted page="finance_reports" /><p>Safe page</p></Suspense></AppErrorBoundary>);
  expect(routeReady).toHaveBeenCalledWith('finance_reports');
});
it('does not clear a notice while a page is still suspended', () => {
  const routeReady = vi.fn(); window.SweaterRecovery = { routeReady };
  const wait = new Promise(() => {}); function Pending() { throw wait; }
  render(<Suspense fallback="loading"><RouteMounted page="finance_workbench" /><Pending /></Suspense>); expect(routeReady).not.toHaveBeenCalled();
});
