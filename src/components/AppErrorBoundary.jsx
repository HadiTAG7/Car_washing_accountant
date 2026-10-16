import { Component, createElement } from 'react';

// Native React elements deliberately avoid translation/runtime dependencies here.
export default class AppErrorBoundary extends Component {
  state = { failed: false, confirmReload: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { console.error('[sweater-ui] render-boundary'); }
  render() {
    if (!this.state.failed) return this.props.children;
    const en = document.documentElement.lang === 'en';
    const text = (ar, english) => en ? english : ar;
    return createElement('section', { role: 'alert', className: 'sw-recovery-card', dir: en ? 'ltr' : 'rtl' },
      createElement('h2', null, text('تعذّر عرض هذا الجزء من الصفحة', 'This part of the page could not be displayed')),
      createElement('p', null, text('لم نعد تحميل الصفحة تلقائيًا. انسخ أي بيانات متاحة وغير محفوظة قبل إعادة التحميل.', 'We did not reload the page automatically. Copy any available unsaved entries before reloading.')),
      createElement('button', { type: 'button', onClick: () => {
        if (window.SweaterRecovery) window.SweaterRecovery.show('render');
        else this.setState({ confirmReload: true });
      } }, text('خيارات الاسترجاع', 'Recovery options')),
      this.state.confirmReload && createElement('div', null,
        createElement('p', null, text('إعادة التحميل تفقد البيانات غير المحفوظة. هل تريد المتابعة؟', 'Reloading loses unsaved entries. Do you want to continue?')),
        createElement('button', { type: 'button', onClick: () => this.setState({ confirmReload: false }) }, text('إلغاء', 'Cancel')),
        createElement('button', { type: 'button', onClick: () => window.location.reload() }, text('نعم، أعد تحميل الصفحة', 'Yes, reload the page')),
      ),
    );
  }
}
