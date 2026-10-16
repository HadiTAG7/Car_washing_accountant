import { useEffect } from 'react';

export default function AppMounted({ children }) {
  useEffect(() => { window.SweaterRecovery?.ready(); }, []);
  return children;
}
