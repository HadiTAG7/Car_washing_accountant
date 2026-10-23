import { generalLedger } from './reports.js';
import { ACC } from './chartOfAccounts.js';
import { round2 } from './journal.js';
import { normalizeAsset } from './depreciation.js';

// Inactive assets still belong to the register. Only an actual disposal
// removes cost; a pause in use must not conceal a reconciliation difference.
export function reconcileAssetCost(assets, entries, lines, { to = null } = {}) {
  const registerCost = round2((assets || []).reduce((sum, raw) => {
    const asset = normalizeAsset(raw);
    if (asset.disposalDate && (!to || asset.disposalDate <= to)) return sum;
    return sum + (asset.assetAccount === ACC.FIXED_ASSETS ? asset.cost : 0);
  }, 0));
  const ledgerCost = generalLedger(ACC.FIXED_ASSETS, entries, lines, { to }).closing;
  const difference = round2(registerCost - ledgerCost);
  return { registerCost, ledgerCost, difference, matched: difference === 0 };
}

export function canPostAssetCharges({ loading, error, costReconciliation, pendingCount }) {
  return !loading && !error && costReconciliation?.matched === true && pendingCount > 0;
}
