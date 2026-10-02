export const journeyReport = {
  partnerId: 'p1', factor: 0.2, from: '2026-09-01', through: '2026-09-30', asOf: '2026-10-02T18:00:00Z',
  capitalJourney: {
    version: 1, complete: true, warnings: [], received: 20000, funded: 20000, budget: 20000,
    initialTotal: 10000, operatingTotal: 1000, reserveTotal: 200, remaining: 8800, beyondBalance: 0,
    receipts: [{ id: 'own-receipt', date: '2026-09-01', amount: 20000 }],
    initialItems: [
      { id: 'franchise', description: 'رسوم الفرنشايز', date: '2026-09-02', kind: 'startup', amount: 4000 },
      { id: 'bike', description: 'قيمة الدباب', date: '2026-09-03', kind: 'startup', amount: 6000 },
    ],
    months: [{ periodKey: '2026-09', operatingCost: 1000, reserve: 200, covered: 1200, uncovered: 0, remaining: 8800,
      groups: [
        { key: 'variable', label: 'المصاريف المتغيرة والعمولات', amount: 300,
          items: [{ id: 'fuel', description: 'بنزين التشغيل', date: '2026-09-05', amount: 300, basis: 'recorded' }] },
        { key: 'monthly', label: 'المصاريف الشهرية والرواتب', amount: 700,
          items: [{ id: 'salary', description: 'الرواتب', date: '2026-09-01', amount: 700, basis: 'scheduled' }] },
        { key: 'annual', label: 'احتياطي التجديد السنوي', amount: 200,
          items: [{ id: 'housing', description: 'تجديد السكن', date: '2026-09-01', amount: 200, basis: 'reserve' }] },
      ],
    }],
  },
};
