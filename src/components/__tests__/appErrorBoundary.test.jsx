// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import AppErrorBoundary from '../AppErrorBoundary';
let log;
beforeEach(() => { log = vi.spyOn(console, 'error').mockImplementation(() => {}); document.documentElement.lang = 'ar'; });
afterEach(() => { cleanup(); log.mockRestore(); delete window.SweaterRecovery; delete window.SweaterDiagnostics; });
function Broken() { throw new Error('Synthetic rendering failure'); }
it.each(['ar', 'en'])('keeps the shell and another unsaved form when the routed page throws (%s)', language => {
  document.documentElement.lang = language;
  const show = vi.fn(); window.SweaterRecovery = { show };
  render(<><input aria-label="Synthetic unsaved form" defaultValue="keep this draft" /><nav>Safe navigation</nav>
    <AppErrorBoundary><Broken /></AppErrorBoundary></>);
  expect(screen.getByRole('alert').textContent).toContain(language === 'ar' ? 'تعذّر عرض' : 'could not be displayed');
  expect(screen.getByLabelText('Synthetic unsaved form').value).toBe('keep this draft');
  expect(screen.getByText('Safe navigation')).toBeTruthy(); expect(show).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: language === 'ar' ? 'خيارات الاسترجاع' : 'Recovery options' }));
  expect(show).toHaveBeenCalledWith('render');
});
it('catches a rejected lazy route and recovers only when the user navigates to a different route', async () => {
  const FailedRoute = lazy(() => Promise.reject(new Error('Synthetic old chunk failed')));
  const view = render(<AppErrorBoundary key="a"><Suspense fallback={<p>Loading</p>}><FailedRoute /></Suspense></AppErrorBoundary>);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  view.rerender(<AppErrorBoundary key="b"><p>Different safe page</p></AppErrorBoundary>);
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByText('Different safe page')).toBeTruthy();
});
it('still asks before a manual reload if the independent recovery script is unavailable', () => {
  render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
  expect(screen.queryByText('نعم، أعد تحميل الصفحة')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'خيارات الاسترجاع' }));
  expect(screen.getByText(/إعادة التحميل تفقد/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
  expect(screen.queryByText('نعم، أعد تحميل الصفحة')).toBeNull();
});
it('captures the actual React error and component context, shows its safe reference, and preserves sibling drafts', () => {
  const record = vi.fn(() => 'sw-1792400000000-1'); window.SweaterDiagnostics = { record };
  render(<><input aria-label="Unsaved draft" defaultValue="keep draft" /><AppErrorBoundary><Broken /></AppErrorBoundary></>);
  expect(record).toHaveBeenCalledWith('render', expect.any(Error), expect.objectContaining({ componentStack: expect.stringContaining('Broken') }));
  expect(screen.getByText('sw-1792400000000-1')).toBeTruthy(); expect(screen.getByLabelText('Unsaved draft').value).toBe('keep draft');
});
it('keeps recovery usable even if diagnostic recording fails', () => {
  window.SweaterDiagnostics = { record: () => { throw new Error('unavailable'); } };
  render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
  expect(screen.getByRole('alert')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'خيارات الاسترجاع' }));
  expect(screen.getByText(/إعادة التحميل تفقد/)).toBeTruthy();
});
