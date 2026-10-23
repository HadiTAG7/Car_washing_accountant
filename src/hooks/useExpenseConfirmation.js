import { useCallback, useRef, useState, useEffect } from 'react';
export function useExpenseConfirmation() {
  const [request, setRequest] = useState(null), pending = useRef(null);
  const confirm = useCallback(details => new Promise((resolve, reject) => {
    if (pending.current) { reject(Object.assign(new Error('يوجد تأكيد آخر مفتوح.'), { code: 'cancelled' })); return; }
    pending.current = { resolve, reject }; setRequest(details);
  }), []);
  const finish = useCallback(value => {
    const current = pending.current; pending.current = null; setRequest(null);
    if (value) current?.resolve(value); else current?.reject(Object.assign(new Error('أُلغي التعديل؛ لم يتغير السجل.'), { code: 'cancelled' }));
  }, []);
  useEffect(() => () => { pending.current?.reject(Object.assign(new Error('أُغلقت الصفحة دون حفظ.'), { code: 'cancelled' })); pending.current = null; }, []);
  return { request, confirm, finish };
}
