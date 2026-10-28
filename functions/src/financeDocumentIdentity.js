export function financeDocumentIdentity(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname === 'drive.google.com') {
      const driveId = parsed.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1] || parsed.searchParams.get('id');
      if (driveId && /^[\w-]+$/.test(driveId)) return `drive:${driveId}`;
    }
    return parsed.href;
  } catch { return null; }
}
