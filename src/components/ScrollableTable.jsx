import { useEffect, useRef, useState } from 'react';

export default function ScrollableTable({ children, className = '' }) {
  const ref = useRef(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = ref.current;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return <div className="min-w-0">
    {overflow && <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300 mb-2">
      <span>مرّر الجدول أفقيًا لعرض بقية الأعمدة</span>
      <button type="button" className="sw-button sw-button--sm sw-button--secondary" aria-label="تمرير الجدول يمينًا" onClick={() => ref.current.scrollBy({ left: 240, behavior: 'smooth' })}>→</button>
      <button type="button" className="sw-button sw-button--sm sw-button--secondary" aria-label="تمرير الجدول يسارًا" onClick={() => ref.current.scrollBy({ left: -240, behavior: 'smooth' })}>←</button>
    </div>}
    <div ref={ref} className={className} role="region" aria-label="جدول قابل للتمرير" tabIndex={overflow ? 0 : undefined}>{children}</div>
  </div>;
}
