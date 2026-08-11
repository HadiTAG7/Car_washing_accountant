// ═══════════════════════════════════════════════════════════════════════════
// منفذ نداء الخادم — the single door to the callable functions
// ═══════════════════════════════════════════════════════════════════════════
// Every write to the ledger and to the tax documents goes through this one
// function. In the app it is the callable-functions client; the emulator
// suites swap it for a direct call into `functions/src/`, running against the
// same database, so those tests exercise the REAL server logic rather than a
// mock of it.
//
// One seam, named for what it does. Two modules used to reach for the
// callable client independently, and swapping one of them left the other
// talking to a Cloud Function that does not exist in a test.
// ═══════════════════════════════════════════════════════════════════════════

import { callLedger } from './firebaseClient';

let transport = callLedger;

export const callServer = (name, payload) => transport(name, payload);

/** Test-only. Returns the previous transport so a suite can restore it. */
export function __setLedgerTransport(fn) {
  const previous = transport;
  transport = fn || callLedger;
  return previous;
}
