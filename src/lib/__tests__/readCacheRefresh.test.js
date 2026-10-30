import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedRead, peekCached, onReadRefresh, refreshCollections, refreshAllReads, __resetReadCache } from '../readCache';

// Another open tab of the app: same browser, same channel name.
let otherTab;
beforeEach(() => { __resetReadCache(); otherTab = new BroadcastChannel('sweater-read-cache'); });
afterEach(() => { otherTab.close(); __resetReadCache(); });
const nextMessage = channel => new Promise(resolve => { channel.onmessage = ({ data }) => resolve(data); });

describe('refreshing the ledger reads after a posting', () => {
  it('drops the posted collections, re-reads only the mounted readers that hold them, and tells the other tabs', async () => {
    await cachedRead('journal_entries', async () => ['old']);
    await cachedRead('incomeSources:2026-10', async () => ['old'], { tags: ['variable_expenses', 'journal_entries'] });
    await cachedRead('bikers', async () => ['kept']);
    const ledger = vi.fn(), income = vi.fn(), bikers = vi.fn(), button = vi.fn();
    onReadRefresh(ledger, ['journal_entries']); onReadRefresh(income, ['variable_expenses', 'journal_entries']);
    onReadRefresh(bikers, ['bikers']); onReadRefresh(button);
    const told = nextMessage(otherTab);
    refreshCollections(['journal_entries', 'journal_lines', 'posting_locks']);
    expect(peekCached('journal_entries')).toBeNull();
    expect(peekCached('incomeSources:2026-10')).toBeNull();
    expect(peekCached('bikers')).toBeTruthy();
    expect(ledger).toHaveBeenCalledWith({ force: false });
    expect(income).toHaveBeenCalledWith({ force: false });
    expect(bikers).not.toHaveBeenCalled();
    expect(button).not.toHaveBeenCalled();
    // Only the collection names cross tabs.
    expect(await told).toEqual({ type: 'refresh', collections: ['journal_entries', 'journal_lines', 'posting_locks'] });
  });

  it('re-reads here when another tab posts, without echoing it back', async () => {
    await cachedRead('journal_entries', async () => ['old']);
    const ledger = vi.fn(), echo = vi.fn();
    onReadRefresh(ledger, ['journal_entries']);
    otherTab.onmessage = echo;
    const sender = new BroadcastChannel('sweater-read-cache');
    sender.postMessage({ type: 'refresh', collections: ['journal_entries', 7] });
    await vi.waitFor(() => expect(ledger).toHaveBeenCalledWith({ force: false }));
    expect(peekCached('journal_entries')).toBeNull();
    sender.postMessage({ type: 'other', collections: ['journal_entries'] });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(ledger).toHaveBeenCalledTimes(1);
    // The other tab saw only the two messages the sender posted, nothing re-broadcast.
    expect(echo).toHaveBeenCalledTimes(2);
    sender.close();
  });

  it('keeps the refresh button re-reading everything on screen', () => {
    const ledger = vi.fn(), button = vi.fn();
    onReadRefresh(ledger, ['journal_entries']); onReadRefresh(button);
    refreshAllReads();
    expect(ledger).toHaveBeenCalledTimes(1);
    expect(button).toHaveBeenCalledTimes(1);
  });
});
