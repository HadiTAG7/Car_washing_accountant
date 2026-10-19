// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const runtimePath = 'public/app-recovery.js';
let reload, diagnostic, host;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  localStorage.clear();
  reload = vi.fn(); diagnostic = vi.fn();
  host = { addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
    setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    localStorage, location: { reload }, console: { error: diagnostic } };
  if (existsSync(runtimePath)) new Function('window', 'document', readFileSync(runtimePath, 'utf8'))(host, document);
});
afterEach(() => { host.SweaterRecovery?.dispose(); vi.useRealTimers(); document.body.innerHTML = ''; });
it('has a readable HTML fallback before any application bundle loads', () => {
  expect(document.querySelector('#sw-boot-message')?.textContent).toContain('سويتر');
  expect(document.querySelector('script[src="/app-recovery.js"]')).not.toBeNull();
});
it('a stale dynamic import preserves existing form values, never reloads, and requires explicit confirmation', () => {
  const input = document.createElement('input'); input.value = 'Synthetic unsaved draft'; document.querySelector('#root').append(input);
  const event = new Event('vite:preloadError', { cancelable: true });
  event.payload = new Error('SECRET synthetic error contents must not be logged');
  window.dispatchEvent(event); vi.advanceTimersByTime(60000);
  expect(document.querySelector('#sw-recovery')?.hidden).toBe(false);
  expect(input.isConnected).toBe(true); expect(input.value).toBe('Synthetic unsaved draft'); expect(reload).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
  document.querySelector('#sw-recovery-reload').click();
  expect(reload).not.toHaveBeenCalled(); expect(document.querySelector('#sw-recovery-confirm').hidden).toBe(false);
  document.querySelector('#sw-recovery-cancel').click(); expect(reload).not.toHaveBeenCalled();
  document.querySelector('#sw-recovery-reload').click(); document.querySelector('#sw-recovery-confirm-reload').click();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('SECRET');
});
it('dismissal preserves the form and a later error does not reuse a previous confirmation', () => {
  window.dispatchEvent(new Event('vite:preloadError'));
  document.querySelector('#sw-recovery-reload')?.click(); document.querySelector('#sw-recovery-dismiss')?.click();
  window.dispatchEvent(new Event('vite:preloadError'));
  expect(document.querySelector('#sw-recovery-confirm')?.hidden).toBe(true); expect(reload).not.toHaveBeenCalled();
});
it('slow boot shows a non-destructive notice; late successful mount clears only the slow-boot notice', () => {
  vi.advanceTimersByTime(15000); expect(document.querySelector('#sw-recovery')?.hidden).toBe(false);
  host.SweaterRecovery?.ready(); expect(document.querySelector('#sw-recovery')?.hidden).toBe(true);
  vi.advanceTimersByTime(60000); expect(reload).not.toHaveBeenCalled();
});
it('handles entry script failure, but ignores unrelated image failures', () => {
  host.SweaterRecovery?.ready();
  const img = document.createElement('img'); document.body.append(img); img.dispatchEvent(new Event('error'));
  expect(document.querySelector('#sw-recovery')?.hidden).toBe(true);
  const script = document.createElement('script'); script.src = '/assets/entry-test.js'; document.body.append(script);
  script.dispatchEvent(new Event('error'));
  expect(document.querySelector('#sw-recovery')?.hidden).toBe(false); expect(reload).not.toHaveBeenCalled();
});
it('does not hide an actual module failure as a late successful boot after the slow notice', () => {
  vi.advanceTimersByTime(15000); window.dispatchEvent(new Event('vite:preloadError'));
  host.SweaterRecovery.ready();
  expect(document.querySelector('#sw-recovery').hidden).toBe(false); expect(reload).not.toHaveBeenCalled();
});
it('uses English recovery text without fetching a translation bundle', () => {
  localStorage.setItem('sweater:language', 'en'); window.dispatchEvent(new Event('vite:preloadError'));
  expect(document.querySelector('#sw-recovery')?.textContent).toContain('unsaved');
  expect(document.querySelector('#sw-recovery')?.getAttribute('dir')).toBe('ltr');
  expect(reload).not.toHaveBeenCalled();
});
it('returns keyboard focus after cancel and dismissal without changing an unsaved draft', () => {
  const trigger = document.createElement('button'); trigger.textContent = 'Recovery trigger'; document.querySelector('#root').append(trigger);
  const input = document.createElement('input'); input.value = 'Synthetic unsaved draft'; document.querySelector('#root').append(input);
  trigger.focus(); host.SweaterRecovery.show('render');
  const options = document.querySelector('#sw-recovery-reload'); options.focus(); options.click();
  const cancel = document.querySelector('#sw-recovery-cancel'); cancel.focus(); cancel.click();
  expect(document.activeElement).toBe(options); expect(document.querySelector('#sw-recovery-confirm').hidden).toBe(true);
  const dismiss = document.querySelector('#sw-recovery-dismiss'); dismiss.focus(); dismiss.click();
  expect(document.activeElement).toBe(trigger); expect(input.value).toBe('Synthetic unsaved draft'); expect(reload).not.toHaveBeenCalled();
});
it('uses a visible root fallback if the original trigger was removed and never steals another form focus', () => {
  const trigger = document.createElement('button'); document.querySelector('#root').append(trigger); trigger.focus(); host.SweaterRecovery.show('render'); trigger.remove();
  const dismiss = document.querySelector('#sw-recovery-dismiss'); dismiss.focus(); dismiss.click(); expect(document.activeElement).toBe(document.querySelector('#root'));
  host.SweaterRecovery.show('slow-boot');
  const input = document.createElement('input'); input.value = 'draft'; document.querySelector('#root').append(input); input.focus();
  host.SweaterRecovery.ready(); expect(document.activeElement).toBe(input); expect(input.value).toBe('draft'); expect(reload).not.toHaveBeenCalled();
});
