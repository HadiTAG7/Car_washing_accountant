// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
const mount = vi.hoisted(() => vi.fn());
vi.mock('react-dom/client', () => ({ createRoot: mount }));
vi.mock('../../App.jsx', () => { throw new TypeError('Synthetic missing app chunk'); });
afterEach(() => { vi.restoreAllMocks(); delete window.SweaterRecovery; document.body.innerHTML = ''; });
it('catches a failed startup import without an unhandled rejection, clearing the fallback or reloading', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const show = vi.fn(); window.SweaterRecovery = { show };
  document.body.innerHTML = '<div id="root"><p role="status">Synthetic initial loading fallback</p></div>';
  await import('../../main.jsx');
  await waitFor(() => expect(show).toHaveBeenCalledWith('boot'));
  expect(mount).not.toHaveBeenCalled();
  expect(document.querySelector('[role=status]').textContent).toBe('Synthetic initial loading fallback');
  expect(log).toHaveBeenCalledWith('[sweater-ui] boot-failed');
});
