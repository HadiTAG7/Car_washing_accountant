import { FINANCIAL_SETTINGS } from '../../config/financialSettings.js';
import { round2 } from './journal.js';

export const MANAGEMENT_SHARE_RULE = Object.freeze({ key: 'management',
  label: `حصة الإدارة (${FINANCIAL_SETTINGS.managementShareRate * 100}% من صافي ربح الشهر)`, basis: 'profit',
  rate: FINANCIAL_SETTINGS.managementShareRate, effectiveFrom: null });

// Each call represents one month. A loss is never carried into another month.
export function managementShareAmount(monthProfit) {
  return round2(Math.max(0, Number(monthProfit) || 0) * FINANCIAL_SETTINGS.managementShareRate);
}

export function monthlyFeeRules(rules, to) {
  const configured = rules?.length ? rules : [MANAGEMENT_SHARE_RULE];
  const legacy = configured.some(rule => ['management', 'supervisor'].includes(rule.key));
  const current = legacy
    ? [...configured.filter(rule => !['management', 'supervisor'].includes(rule.key)), MANAGEMENT_SHARE_RULE]
    : configured;
  return current.filter(rule => !rule.effectiveFrom || !to || rule.effectiveFrom <= to);
}
