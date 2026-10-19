import { useEffect } from 'react';

// Mounted within Suspense + the page boundary: not committed for a failed or
// still-suspended page. A successful different route can clear its stale notice.
export default function RouteMounted({ page }) {
  useEffect(() => { window.SweaterRecovery?.routeReady?.(page); }, [page]);
  return null;
}
