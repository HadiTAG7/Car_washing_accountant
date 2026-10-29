import { operationsHandler } from './operationsHttp.js';
import { N8N_PRINCIPAL, verifyN8nRequest } from './n8nKeys.js';

// Use the same validation, preview hashes, atomic writer and readback as v2.
// No metrics, owner confirmation, collection, payroll or ledger dispatch.
export function n8nOperationsHandler(options) {
  return operationsHandler({ ...options, verify: verifyN8nRequest,
    allowedActions: ['preview', 'save', 'status'], requiredPrincipal: N8N_PRINCIPAL });
}
