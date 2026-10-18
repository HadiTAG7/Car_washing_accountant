// Synthetic UI fixture: deliberately not production performance or real names.
export function growthFixture() {
  return { from: '2026-10-10', to: '2026-10-17', readAt: '2026-10-18T18:00:00Z', roster: {at:'2026-10-18T18:12:10.844Z'}, exclusions: [], gaps: [],
    workers: ['1982', '1984', '1986', '1988', '1989', '1998', '1999'].map((code, i) => ({
      id: `fixture-${code}`, code,
      name: i === 1 ? 'بايكر تجريبي باسم طويل لاختبار احتواء القائمة' : `بايكر تجريبي ${i + 1}`,
      nameEnglish: i === 1 ? 'Synthetic biker with a deliberately long display name' : `Test biker ${i + 1}`,
      region: i < 3 ? 'Muroj' : 'Wurood', status: 'Active',
      days: Array.from({ length: 8 }, (_, day) => ({ date: `2026-10-${10 + day}`, count: i === 0 ? 0 : day === 7 ? 7 : 5,
        coverage: 'complete', workEligible: i > 0 ? true : null, assigned: 8, cancelled: 1 })),
    })) };
}
