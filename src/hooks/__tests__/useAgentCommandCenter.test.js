// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
const mock = vi.hoisted(() => ({ listeners: [], stops: [], getDocs: vi.fn() }));
vi.mock('../../lib/firebaseClient', () => ({ db: {}, isFirebaseConfigured: true }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ name }),
  query: (ref, ...constraints) => ({ ...ref, constraints }),
  limit: (count) => ({ limit: count }),
  orderBy: (field, direction) => ({ orderBy: field, direction }),
  where: (field, op, value) => ({ field, op, value }),
  getDocs: mock.getDocs,
  onSnapshot: (ref, callback, error) => { mock.listeners.push({ ref, callback, error }); const stop = vi.fn(); mock.stops.push(stop); callback({ docs: [] }); return stop; },
}));
import { commandCenterSubscriptions, loadAgentCaseHistory, useAgentCommandCenter } from '../useAgentCommandCenter';

afterEach(() => { cleanup(); vi.useRealTimers(); mock.listeners = []; mock.stops = []; mock.getDocs.mockReset(); });

describe('Real-time command center reads', () => {
  it('filters pending approvals and active alerts without a global limit', () => {
    const subscriptions = commandCenterSubscriptions({});
    expect(subscriptions.approvals.constraints).toEqual([{ field: 'status', op: '==', value: 'pending' }]);
    expect(subscriptions.alerts.constraints).toEqual([{ field: 'active', op: '==', value: true }]);
  });
  it('subscribes, reflects new signed rows, ages running status and cleans up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T09:00:00Z'));
    const hook = renderHook(() => useAgentCommandCenter('admin'));
    expect(hook.result.current.loading).toBe(false);
    expect(mock.listeners).toHaveLength(7);
    const agents = mock.listeners.find(({ ref }) => ref.name === 'agent_command_agents');
    act(() => agents.callback({ docs: [{ id: 'cfo', data: () => ({ status: 'healthy', isRunning: true, lastEventAt: new Date().toISOString() }) }] }));
    expect(hook.result.current.summary).toMatchObject({ connected: 1, running: 1 });
    act(() => vi.advanceTimersByTime(16 * 60000));
    expect(hook.result.current.summary).toMatchObject({ connected: 0, stale: 1, running: 0 });
    hook.unmount();
    expect(mock.stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not read data for unprivileged roles and reports permission failures honestly', () => {
    const denied = renderHook(() => useAgentCommandCenter('operator'));
    expect(mock.listeners).toHaveLength(0);
    expect(denied.result.current.hasLiveData).toBe(false);
    denied.unmount();
    const hook = renderHook(() => useAgentCommandCenter('accountant'));
    act(() => mock.listeners[0].error(new Error('permission-denied')));
    expect(hook.result.current.error.message).toBe('permission-denied');
  });
  it('loads the whole case history by exact safe case ID, not latest global events', async () => {
    mock.getDocs.mockResolvedValue({ docs: [{ id: 'old-event', data: () => ({ message: 'older history' }) }] });
    expect(await loadAgentCaseHistory('case_1')).toEqual([{ id: 'old-event', message: 'older history' }]);
    expect(mock.getDocs).toHaveBeenCalledWith({ name: 'agent_command_activity', constraints: [{ field: 'caseId', op: '==', value: 'case_1' }] });
    await expect(loadAgentCaseHistory('../unsafe')).rejects.toThrow();
  });
});
