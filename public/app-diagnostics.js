/* Local-only, bounded diagnostics. No network, identity, raw error text or form reads. */
(function (window, document) {
  'use strict';
  var KEY = 'sweater:ui-diagnostics:v1';
  var TTL = 3 * 24 * 60 * 60 * 1000;
  var LIMIT = 20;
  var kinds = ['render', 'runtime', 'rejection', 'module-load', 'script-load', 'boot'];
  var pages = ['overview', 'annual', 'monthly', 'variable', 'startup', 'washes', 'bikers', 'housing', 'finance', 'growth_performance', 'executive_reports', 'operations_reports', 'agent_command_center', 'ledger', 'trial_balance', 'balance_sheet', 'income_statement', 'payroll', 'partners', 'partner_payments', 'vat', 'vat_recovery', 'assets', 'period_close', 'sweater_integration', 'sweater_settlements', 'finance_workbench', 'finance_reports'];
  var names = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError'];
  var codes = ['unknown', 'null-property', 'undefined-property', 'not-function', 'not-defined', 'not-iterable', 'dynamic-import', 'css-preload', 'react-minified', 'stack-overflow', 'script-resource'];
  var memory = [];
  var persistent = true;
  var sequence = 0;
  function safeFrames(value) {
    // Only generated bundle locations, never the raw stack/URL/query/local path.
    var matches = String(value || '').slice(0, 20000).match(/\/assets\/[A-Za-z0-9_-]{1,120}\.(?:js|css)(?::\d{1,8}){0,2}/g) || [];
    return Array.from(new Set(matches)).slice(0, 8);
  }
  function components(value) {
    return String(value || '').slice(0, 10000).split('\n').map(function (line) {
      var match = /^\s+at ([A-Za-z_$][A-Za-z0-9_$]{0,59})(?:\s|\(|$)/.exec(line);
      return match ? match[1] : null;
    }).filter(Boolean).slice(0, 12);
  }
  function classify(message) {
    if (/Cannot read properties of null/i.test(message)) return 'null-property';
    if (/Cannot read properties of undefined/i.test(message)) return 'undefined-property';
    if (/is not a function/i.test(message)) return 'not-function';
    if (/is not defined/i.test(message)) return 'not-defined';
    if (/is not iterable/i.test(message)) return 'not-iterable';
    if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)) return 'dynamic-import';
    if (/Unable to preload CSS/i.test(message)) return 'css-preload';
    if (/Minified React error #\d+/i.test(message)) return 'react-minified';
    if (/Maximum call stack/i.test(message)) return 'stack-overflow';
    return 'unknown';
  }
  function build() {
    var value = document.querySelector('meta[name="sw-build"]')?.content || '';
    return /^[a-f0-9]{40}$/.test(value) ? value : 'unknown';
  }
  function page() {
    var value = new URLSearchParams(window.location.search || '').get('page') || 'overview';
    return pages.includes(value) ? value : 'other';
  }
  function clean(entry) {
    // Revalidate stored entries too: storage is not a trusted diagnostics source.
    if (!entry || !/^sw-\d{13}-\d{1,6}$/.test(entry.id) || !Number.isFinite(entry.at) || entry.at > Date.now() || Date.now() - entry.at > TTL) return null;
    return { id: entry.id, at: entry.at, lastAt: Number.isFinite(entry.lastAt) ? Math.min(Date.now(), Math.max(entry.at, entry.lastAt)) : entry.at,
      kind: kinds.includes(entry.kind) ? entry.kind : 'runtime',
      page: pages.includes(entry.page) ? entry.page : 'other',
      build: /^[a-f0-9]{40}$/.test(entry.build) ? entry.build : 'unknown',
      name: names.includes(entry.name) ? entry.name : 'Error', code: codes.includes(entry.code) ? entry.code : 'unknown',
      reactCode: Number.isInteger(entry.reactCode) && entry.reactCode >= 0 && entry.reactCode < 10000 ? entry.reactCode : null,
      frames: safeFrames(Array.isArray(entry.frames) ? entry.frames.slice(0, 8).join('\n') : ''),
      components: Array.isArray(entry.components) ? entry.components.filter(function (s) { return typeof s === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,59}$/.test(s); }).slice(0, 12) : [],
      count: Math.min(999, Math.max(1, Number.isInteger(entry.count) ? entry.count : 1)), online: typeof entry.online === 'boolean' ? entry.online : null };
  }
  function read() {
    // A write-only quota failure leaves storage stale. Never overwrite the
    // newer in-memory events with that old snapshot while in fallback mode.
    if (!persistent) return memory.map(clean).filter(Boolean);
    try {
      var raw = window.localStorage.getItem(KEY);
      var data = raw && raw.length <= 60000 ? JSON.parse(raw) : [];
      if (Array.isArray(data)) memory = data.slice(-LIMIT).map(clean).filter(Boolean);
    } catch { persistent = false; }
    return memory.map(clean).filter(Boolean);
  }
  function save(records) {
    memory = records.slice(-LIMIT);
    try { window.localStorage.setItem(KEY, JSON.stringify(memory)); persistent = true; }
    catch { persistent = false; }
  }
  function record(kind, error, info) {
    try {
      var message = typeof error?.message === 'string' ? error.message.slice(0, 4000) : '';
      var code = classify(message);
      var reactCode = /Minified React error #(\d{1,4})\b/i.exec(message);
      var at = Date.now();
      var entry = { id: 'sw-' + at + '-' + (++sequence), at: at, lastAt: at, kind: kinds.includes(kind) ? kind : 'runtime',
        page: page(), build: build(), name: names.includes(error?.name) ? error.name : 'Error', code: code,
        reactCode: reactCode ? Number(reactCode[1]) : null,
        frames: safeFrames(String(error?.stack || '') + '\n' + String(info?.source || '') + '\n' + String(info?.componentStack || '')),
        components: components(info?.componentStack), count: 1,
        online: typeof window.navigator?.onLine === 'boolean' ? window.navigator.onLine : null };
      var records = read();
      var previous = records[records.length - 1];
      if (previous && at - previous.lastAt < 60000 && ['kind', 'page', 'build', 'name', 'code', 'reactCode'].every(function (key) { return previous[key] === entry[key]; }) && JSON.stringify(previous.frames) === JSON.stringify(entry.frames) && JSON.stringify(previous.components) === JSON.stringify(entry.components)) {
        if (at - previous.lastAt < 1000) return previous.id; // An error storm must not hammer storage or console.
        previous.lastAt = at; previous.count = Math.min(999, previous.count + 1); entry = previous;
      } else records.push(entry);
      save(records);
      window.console?.error('[sweater-ui] diagnostic', { id: entry.id, kind: entry.kind, code: entry.code });
      return entry.id;
    } catch { return null; } // Diagnostics must never cause another crash.
  }
  function error(event) {
    if (event.target?.tagName === 'SCRIPT') {
      var src = event.target.getAttribute('src') || '';
      if (/^\/(?:assets\/|src\/main\.)/.test(src)) record('script-load', null, { source: src });
    } else if (event.error) record('runtime', event.error, { source: (event.filename || '') + ':' + (event.lineno || 0) + ':' + (event.colno || 0) });
  }
  function rejection(event) { record('rejection', event.reason); }
  function preload(event) { record('module-load', event.payload); }
  save(read()); // Drop expired records on startup; bounded, not a poller.
  window.addEventListener('error', error, true);
  window.addEventListener('unhandledrejection', rejection);
  window.addEventListener('vite:preloadError', preload);
  window.SweaterDiagnostics = {
    record: record,
    latest: function () { return read().at(-1)?.id || ''; },
    report: function () { var records = read(); return JSON.stringify({ schema: 1, storage: persistent ? 'local' : 'memory-only', retentionHours: 72, events: records }, null, 2); },
    dispose: function () {
      window.removeEventListener('error', error, true);
      window.removeEventListener('unhandledrejection', rejection);
      window.removeEventListener('vite:preloadError', preload);
    },
  };
})(window, document);
