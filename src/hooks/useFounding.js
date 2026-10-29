import { useState } from 'react';
import { useFinanceRead } from './useFinanceRead';
import { callFinanceApi } from '../lib/financeApi';

const READ = { kind: 'founding', request: { action: 'read' } };

/**
 * Hadi's current account, statements and the founding period: one server read
 * (the same plan the server posts from), and explicit actions that re-read.
 */
export function useFounding() {
  const read = useFinanceRead('finance-workbench', READ);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [notice, setNotice] = useState('');
  const call = request => callFinanceApi('finance-workbench', { kind: 'founding', request });
  async function act(request, success = '') {
    setBusy(true); setActionError(''); setNotice('');
    try {
      const result = await call(request);
      if (success) setNotice(success);
      read.refresh();
      return result;
    } catch (error) {
      setActionError(error.message);
      return null;
    } finally { setBusy(false); }
  }
  return { ...read, busy, actionError, notice, act, call, clearMessages: () => { setActionError(''); setNotice(''); } };
}
