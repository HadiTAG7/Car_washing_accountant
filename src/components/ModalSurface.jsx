import { useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Native modal: isolates the background and contains keyboard focus. */
export default function ModalSurface({ children, className = '', onClose }) {
  const ref = useRef(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const heading = dialog.querySelector('h1,h2,h3,h4');
    if (heading) {
      if (!heading.id) heading.id = titleId;
      dialog.setAttribute('aria-labelledby', heading.id);
    }
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    dialog.querySelector('input:not([type="hidden"]):not(:disabled),textarea:not(:disabled),select:not(:disabled)')?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [titleId]);
  return createPortal(
    <dialog ref={ref} aria-label="نافذة التفاصيل" className={`sw-modal-surface ${className}`}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.defaultPrevented) return;
        const controls = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')]
          .filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }}
      onCancel={(event) => { event.preventDefault(); onClose?.(); }}>
      {children}
    </dialog>, document.body,
  );
}
