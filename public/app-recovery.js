/* Independent of the app bundle: recovery must still work if that bundle fails. */
(function (window, document) {
  'use strict';
  var panel = document.getElementById('sw-recovery');
  var confirmation = document.getElementById('sw-recovery-confirm');
  if (!panel || !confirmation) return;
  var lastKind = '';
  var timer;
  function english() {
    try { return window.localStorage.getItem('sweater:language') === 'en'; } catch { return document.documentElement.lang === 'en'; }
  }
  function label(id, ar, en) { document.getElementById(id).textContent = english() ? en : ar; }
  function show(kind) {
    if (!panel.hidden) {
      if (kind !== 'slow-boot') lastKind = kind;
      return; // Never reset an open confirmation or steal form focus.
    }
    lastKind = kind;
    panel.dir = english() ? 'ltr' : 'rtl';
    label('sw-recovery-title', 'تعذّر إكمال عرض الصفحة', 'The page could not finish loading');
    label('sw-recovery-message', 'لم نعد تحميل الصفحة تلقائيًا. انسخ أي بيانات غير محفوظة قبل إعادة التحميل.', 'We did not reload the page automatically. Copy any unsaved entries before reloading.');
    label('sw-recovery-dismiss', 'إغلاق التنبيه والمتابعة', 'Dismiss and continue');
    label('sw-recovery-reload', 'خيارات إعادة التحميل', 'Reload options');
    label('sw-recovery-warning', 'إعادة التحميل تفقد البيانات غير المحفوظة. هل تريد المتابعة؟', 'Reloading loses unsaved entries. Do you want to continue?');
    label('sw-recovery-cancel', 'إلغاء والبقاء في الصفحة', 'Cancel and stay on this page');
    label('sw-recovery-confirm-reload', 'نعم، أعد تحميل الصفحة', 'Yes, reload the page');
    confirmation.hidden = true;
    panel.hidden = false;
    // Only a fixed category, never raw errors, URLs, form values or identity data.
    window.console.error('[sweater-ui] recovery', { kind: kind });
  }
  function dismiss() { panel.hidden = true; confirmation.hidden = true; }
  function ready() {
    window.clearTimeout(timer);
    var boot = document.getElementById('sw-boot');
    if (boot) boot.hidden = true;
    if (lastKind === 'slow-boot') dismiss();
  }
  function preload() { show('module-load'); }
  function error(event) {
    if (event.target && event.target.tagName === 'SCRIPT') show('script-load');
    else if (event.error) show('runtime');
  }
  function rejection(event) {
    if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(String(event.reason && event.reason.message || ''))) show('module-load');
  }
  document.getElementById('sw-recovery-dismiss').onclick = dismiss;
  document.getElementById('sw-recovery-reload').onclick = function () { confirmation.hidden = false; };
  document.getElementById('sw-recovery-cancel').onclick = function () { confirmation.hidden = true; };
  // The only reload path: a second, explicit user click. No automatic retry/reload.
  document.getElementById('sw-recovery-confirm-reload').onclick = function () { window.location.reload(); };
  window.addEventListener('vite:preloadError', preload);
  window.addEventListener('error', error, true);
  window.addEventListener('unhandledrejection', rejection);
  timer = window.setTimeout(function () { show('slow-boot'); }, 15000);
  window.SweaterRecovery = { show: show, ready: ready, dispose: function () {
    window.clearTimeout(timer);
    window.removeEventListener('vite:preloadError', preload);
    window.removeEventListener('error', error, true);
    window.removeEventListener('unhandledrejection', rejection);
  } };
})(window, document);
