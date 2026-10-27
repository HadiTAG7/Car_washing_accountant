// Read-only grouping of historical attribution; never rewrite sourceRole.
const labels = { operations: 'مدير العمليات', sync: 'المزامنة', assets: 'الأصول والصيانة', other: 'فرق عمليات أخرى' };
export function operationsTeam(report) {
  const label = String(report.sourceLabel || '');
  if (/الأصول|الصيانة/u.test(label)) return 'assets';
  if (/مزامنة|المزامنة/u.test(label)) return 'sync';
  if (/مدير العمليات/u.test(label) || [4, 6, 12].includes(report.sourceRole)) return 'operations';
  return ({ 7: 'sync', 8: 'assets' })[report.sourceRole] || 'other';
}
export function operationsTeamOptions(reports) {
  return Object.entries(labels).flatMap(([id, label]) => {
    const sources = reports.filter(report => operationsTeam(report) === id);
    if (!sources.length) return [];
    const attribution = [...new Set(sources.map(report => report.sourceLabel || `الدور الأصلي ${report.sourceRole}`))];
    return [{ id, label, tooltip: attribution.join(' · ') }];
  });
}
