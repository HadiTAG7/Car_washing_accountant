import { canonicalTabId } from '../lib/navGroups';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BEFORE_PAGE_NAVIGATION } from '../lib/navigationEvents';

function pageFromLocation(defaultTab) {
  if (typeof window === 'undefined') return defaultTab;
  return canonicalTabId(new URLSearchParams(window.location.search).get('page') || defaultTab);
}

// The URL holds only a tab id, never a partner id or financial data. App still
// resolves it against the current role/view before rendering any page.
export function usePageNavigation(defaultTab = 'overview') {
  const [activeTab, setActiveTab] = useState(() => pageFromLocation(defaultTab));
  const currentLocation = useRef(typeof window === 'undefined' ? '' : window.location.href);

  useEffect(() => {
    const initial = new URL(window.location.href);
    const page = initial.searchParams.get('page');
    if (page && canonicalTabId(page) !== page) {
      initial.searchParams.set('page', canonicalTabId(page));
      window.history.replaceState(null, '', initial);
    }
    currentLocation.current = window.location.href;
    const onPopState = () => {
      const next = pageFromLocation(defaultTab);
      const currentPage = canonicalTabId(new URL(currentLocation.current).searchParams.get('page') || defaultTab);
      if (next !== currentPage && !window.dispatchEvent(new CustomEvent(BEFORE_PAGE_NAVIGATION, { cancelable: true, detail: { page: next } }))) {
        window.history.replaceState(window.history.state, '', currentLocation.current);
        return;
      }
      currentLocation.current = window.location.href;
      setActiveTab(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [defaultTab]);

  const selectTab = useCallback((tabId) => {
    tabId = canonicalTabId(tabId);
    const url = new URL(window.location.href);
    url.searchParams.set('page', tabId);
    if (url.href !== window.location.href) {
      if (!window.dispatchEvent(new CustomEvent(BEFORE_PAGE_NAVIGATION, { cancelable: true, detail: { page: tabId } }))) return false;
      window.history.pushState(null, '', url);
    }
    currentLocation.current = window.location.href;
    setActiveTab(tabId);
    return true;
  }, []);

  // Do not write a fallback to the URL while auth/membership is loading: the
  // requested page must survive until the user's actual view is known.
  return [activeTab, selectTab];
}
