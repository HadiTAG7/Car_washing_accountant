// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const diagnosticSource = readFileSync('public/app-diagnostics.js', 'utf8');
const recoverySource = readFileSync('public/app-recovery.js', 'utf8');
const KEY = 'sweater:ui-diagnostics:v1';
let host, reload, writeText, storage;
function start() { new Function('window', 'document', diagnosticSource)(host, document); }
function events() { return JSON.parse(host.SweaterDiagnostics.report()).events; }
beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '<meta name="sw-build" content="' + 'a'.repeat(40) + '">';
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  localStorage.clear();
  reload = vi.fn(); writeText = vi.fn().mockResolvedValue();
  storage = { getItem: vi.fn((key) => localStorage.getItem(key)), setItem: vi.fn((key, value) => localStorage.setItem(key, value)) };
  host = { addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
    setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    localStorage: storage, location: { search: '?page=annual&email=SECRET@example.test#PRIVATE', reload },
    navigator: { onLine: true, clipboard: { writeText } }, console: { error: vi.fn() } };
  start();
});
afterEach(() => { host.SweaterDiagnostics?.dispose(); host.SweaterRecovery?.dispose(); vi.useRealTimers(); document.body.innerHTML = ''; document.head.innerHTML = ''; });
it('records useful technical context but never raw errors, URLs, form values, identity, or arbitrary fields', () => {
  document.querySelector('#root').innerHTML = '<input value="PRIVATE form draft"><textarea>PRIVATE memo</textarea>';
  const error = new TypeError("Cannot read properties of undefined (reading 'PRIVATE account') SECRET@example.test 0501234567 token=PRIVATE");
  error.stack = "TypeError: PRIVATE\n at AnnualPage (https://app.test/assets/annual-abc123.js:23:19?token=PRIVATE)\n C:/Users/PRIVATE/test.jsx:2:3";
  const id = host.SweaterDiagnostics.record('render', error, { componentStack: '\n    at AnnualPage (https://app.test/assets/annual-abc123.js:23:19)\n    at AppBoundary (PRIVATE)', account: 'PRIVATE' });
  expect(id).toMatch(/^sw-\d{13}-1$/);
  expect(events()[0]).toMatchObject({ page: 'annual', build: 'a'.repeat(40), code: 'undefined-property', name: 'TypeError', frames: ['/assets/annual-abc123.js:23:19'], components: ['AnnualPage', 'AppBoundary'] });
  const report = host.SweaterDiagnostics.report();
  expect(report).not.toMatch(/PRIVATE|SECRET|0501234567|https:|C:\/Users|token|email/);
  expect(JSON.stringify(host.console.error.mock.calls)).not.toMatch(/PRIVATE|SECRET/);
  expect(document.querySelector('input').value).toBe('PRIVATE form draft');
  expect(reload).not.toHaveBeenCalled(); expect(writeText).not.toHaveBeenCalled();
});
it('captures runtime, rejected promises, module failure, and app script failure independently', () => {
  window.dispatchEvent(new ErrorEvent('error', { error: new ReferenceError('PRIVATE is not defined') }));
  const rejection = new Event('unhandledrejection'); rejection.reason = new TypeError('PRIVATE is not a function'); window.dispatchEvent(rejection);
  const preload = new Event('vite:preloadError', { cancelable: true }); preload.payload = new TypeError('Failed to fetch dynamically imported module: SECRET'); window.dispatchEvent(preload);
  const script = document.createElement('script'); script.src = '/assets/main-test.js?PRIVATE'; document.body.append(script); script.dispatchEvent(new Event('error'));
  expect(events().map(e => e.kind)).toEqual(['runtime', 'rejection', 'module-load', 'script-load']);
  expect(events().map(e => e.code)).toEqual(['not-defined', 'not-function', 'dynamic-import', 'unknown']);
  expect(preload.defaultPrevented).toBe(false); expect(reload).not.toHaveBeenCalled();
});
it('ignores image errors and unrelated external script failures', () => {
  const img = document.createElement('img'); document.body.append(img); img.dispatchEvent(new Event('error'));
  const script = document.createElement('script'); script.src = 'https://external.test/PRIVATE.js'; document.body.append(script); script.dispatchEvent(new Event('error'));
  expect(events()).toHaveLength(0);
});
it('retains at most 20 events across a reload and expires them after 72 hours', () => {
  for (let i = 0; i < 24; i++) { host.SweaterDiagnostics.record('runtime', Object.assign(new Error('PRIVATE'), { stack: '/assets/chunk-' + i + '.js:1:2' })); }
  expect(events()).toHaveLength(20);
  const prior = events(); host.SweaterDiagnostics.dispose(); start(); expect(events()).toEqual(prior);
  vi.advanceTimersByTime(72 * 60 * 60 * 1000 + 1);
  host.SweaterDiagnostics.dispose(); start(); expect(events()).toEqual([]); expect(JSON.parse(localStorage.getItem(KEY))).toEqual([]);
});
it('deduplicates repeats and throttles a synchronous error storm without touching other storage', () => {
  localStorage.setItem('draft:sentinel', 'PRIVATE unsaved draft');
  const error = Object.assign(new TypeError('PRIVATE is not a function'), { stack: '/assets/main-test.js:1:2' });
  const id = host.SweaterDiagnostics.record('render', error);
  const writes = storage.setItem.mock.calls.length;
  for (let i = 0; i < 100; i++) expect(host.SweaterDiagnostics.record('render', error)).toBe(id);
  expect(storage.setItem).toHaveBeenCalledTimes(writes);
  vi.advanceTimersByTime(1001); expect(host.SweaterDiagnostics.record('render', error)).toBe(id);
  expect(events()[0].count).toBe(2); expect(events()).toHaveLength(1);
  expect(localStorage.getItem('draft:sentinel')).toBe('PRIVATE unsaved draft');
});
it('survives blocked storage with a truthful in-memory report and no reload', () => {
  storage.getItem.mockImplementation(() => { throw new Error('blocked'); }); storage.setItem.mockImplementation(() => { throw new Error('quota'); });
  expect(() => host.SweaterDiagnostics.record('boot', new Error('PRIVATE'))).not.toThrow();
  const report = JSON.parse(host.SweaterDiagnostics.report()); expect(report.storage).toBe('memory-only'); expect(report.events).toHaveLength(1);
  expect(reload).not.toHaveBeenCalled();
});
it('drops corrupt, oversized, expired storage and revalidates unknown fields before export', () => {
  const record = { id: 'sw-' + Date.now() + '-1', at: Date.now(), kind: 'PRIVATE', page: 'PRIVATE', build: 'PRIVATE', name: 'PRIVATE', code: 'PRIVATE', secret: 'PRIVATE', components: ['PRIVATE account'], frames: ['https://PRIVATE.test/SECRET?token=PRIVATE'] };
  localStorage.setItem(KEY, JSON.stringify([record])); expect(host.SweaterDiagnostics.report()).not.toMatch(/PRIVATE|SECRET|token/);
  localStorage.setItem(KEY, '{bad-json'); expect(() => host.SweaterDiagnostics.record('runtime', null)).not.toThrow();
  localStorage.setItem(KEY, 'x'.repeat(60001)); expect(events()).toEqual([]);
});
it('uses only approved route IDs and numeric React error codes, not query data or decode arguments', () => {
  host.location.search = '?page=PRIVATE&partnerId=PRIVATE';
  host.SweaterDiagnostics.record('render', new Error('Minified React error #418; visit https://react.dev/errors/418?args[]=PRIVATE'));
  expect(events()[0]).toMatchObject({ page: 'other', code: 'react-minified', reactCode: 418 });
  expect(host.SweaterDiagnostics.report()).not.toContain('PRIVATE');
});
it('copies a safe report only on the explicit button click and keeps an unsaved form throughout', async () => {
  new Function('window', 'document', recoverySource)(host, document);
  host.SweaterRecovery.ready();
  const input = document.createElement('input'); input.value = 'PRIVATE draft'; document.querySelector('#root').append(input);
  host.SweaterDiagnostics.record('render', new TypeError('PRIVATE is not a function'));
  host.SweaterRecovery.show('render'); expect(writeText).not.toHaveBeenCalled();
  expect(document.querySelector('#sw-recovery-reference').textContent).toMatch(/^sw-/);
  document.querySelector('#sw-recovery-copy').click(); await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).not.toContain('PRIVATE');
  expect(document.querySelector('#sw-recovery-diagnostic-text').readOnly).toBe(true);
  expect(document.querySelector('#sw-recovery-copy-status').textContent).toContain('تم نسخ');
  expect(input.value).toBe('PRIVATE draft'); expect(input.isConnected).toBe(true); expect(reload).not.toHaveBeenCalled();
  document.querySelector('#sw-recovery-dismiss').click(); expect(document.querySelector('#sw-recovery').hidden).toBe(true);
  vi.advanceTimersByTime(120000); expect(reload).not.toHaveBeenCalled();
});
it.each(['denied', 'missing'])('offers a readonly manual-copy fallback when clipboard is %s', async mode => {
  if (mode === 'denied') writeText.mockRejectedValue(new Error('denied')); else delete host.navigator.clipboard;
  new Function('window', 'document', recoverySource)(host, document);
  host.SweaterDiagnostics.record('render', new Error('PRIVATE'));
  host.SweaterRecovery.show('render'); document.querySelector('#sw-recovery-copy').click();
  await vi.waitFor(() => expect(document.querySelector('#sw-recovery-copy-status').textContent).toMatch(/انسخ/));
  expect(document.querySelector('#sw-recovery-diagnostic-text').value).toContain('"events"'); expect(reload).not.toHaveBeenCalled();
});
