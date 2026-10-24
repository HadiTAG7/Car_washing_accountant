const params = new URLSearchParams(window.location.search);
export const bikers = [{ id: 'one', driverExternalId: '1984', name: 'بايكر تجريبي — نقاط مقاسة' },
  { id: 'two', driverExternalId: '1986', name: 'بايكر تجريبي — لا بيانات' }];
export const usePartnerView = () => ({ role: params.get('role') || 'admin', isPartnerView: params.has('partner') });
export const useOverviewBikerQuality = () => ({ available: true, loading: false, error: null, refetch() {}, data: [
  { bikerUID: 'one', data: { reports: [{ id: 'example', bikerUID: 'one', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-23',
    sourceReadDate: '2026-10-24', rulesVersion: 'cqo-20261015-v3', components: [
      { key: 'washQuality', weight: 30, points: 23.71, n: 10 }, { key: 'duration', weight: 10, points: 8, n: 5 },
      { key: 'lateness', weight: 5, points: 0, n: 1 },
    ] }] } },
  params.has('failed') ? { bikerUID: 'two', failed: true } : { bikerUID: 'two', data: { reports: [] } },
] });
