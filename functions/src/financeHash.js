import { createHash } from 'node:crypto';

const stable = value => {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
};
export const financeHash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function financeSourceHash(row) {
  return financeHash(Object.fromEntries(Object.entries(row).filter(([key]) => !['updated_at', 'updated_by', 'approval_status', 'id'].includes(key))));
}
