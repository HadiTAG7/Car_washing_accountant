import { canonicalTabId } from '../lib/navGroups';
import { useCallback, useEffect, useState } from 'react';

function pageFromLocation(defaultTab) {
  if (typeof window === 'undefined') return defaultTab;
  return canonicalTabId(new URLSearchParams(window.location.search).get('page') || defaultTab);
}

// The URL holds only a tab id, never a partner id or financial data. App still
// resolves it against the current role/view before rendering any page.
export function usePageNavigation(defaultTab = 'overview') {
  const [activeTab, setActiveTab] = useState(() => pageFromLocation(defaultTab));

  useEffect(() => {
    const initial = new URL(window.location.href);
    const page = initial.searchParams.get('page');
    if (page && canonicalTabId(page) !== page) {
      initial.searchParams.set('page', canonicalTabId(page));
      window.history.replaceState(null, '', initial);
    }
    const onPopState = () => setActiveTab(pageFromLocation(defaultTab));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [defaultTab]);

  const selectTab = useCallback((tabId) => {
    tabId = canonicalTabId(tabId);
    const url = new URL(window.location.href);
    url.searchParams.set('page', tabId);
    if (url.href !== window.location.href) {
      window.history.pushState(null, '', url);
    }
    setActiveTab(tabId);
  }, []);

  // Do not write a fallback to the URL while auth/membership is loading: the
  // requested page must survive until the user's actual view is known.
  return [activeTab, selectTab];
}
