// ═══════════════════════════════════════════════════════════════════════════
// الاتصال — عميلٌ عادي، لا باب خلفي
// ═══════════════════════════════════════════════════════════════════════════
// This server talks to the project through the **client** SDK, signed in as a
// real user, exactly as the app does. That choice is the whole design, and the
// alternative is worth naming so nobody undoes it later:
//
// A service-account key would have been simpler. It would also have bypassed
// every invariant this codebase exists to enforce. `firestore.rules` refuses
// client writes to the ledger; the callables balance the entry, derive its
// period from its date, refuse a closed one, mint the number atomically, check
// the posting lock and write the audit record — all in one transaction. The
// Admin SDK is *outside* that. A server holding a service-account key would
// make an LLM the single most privileged actor in an accounting system, able
// to write an unbalanced entry into a filed month with nothing to stop it.
//
// So: sign in, carry a token, and be bound by the same role as a person.
//
// ── الإسناد ──
// Give this server its OWN Firebase Auth account — `…+ai@…` with role
// `accountant` — rather than sharing yours. `audit_logs.userId` then names it
// on every write, so «what did the assistant do this week?» is a question with
// an answer, and the role caps what it could do even if a prompt went wrong.
// No server change is needed for that; identity already flows from the token.
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const DEFAULT_CONFIG = {
  apiKey: 'AIzaSyC-d8DWDYuFQ318DaUOWKBoAXAn0_LgFjM',
  authDomain: 'gemini-eed4a.firebaseapp.com',
  projectId: 'gemini-eed4a',
  storageBucket: 'gemini-eed4a.firebasestorage.app',
  messagingSenderId: '224622606731',
  appId: '1:224622606731:web:9150dc23065cc692bf578e',
};

const env = (name, fallback = '') => String(process.env[name] ?? '').trim() || fallback;

export const config = {
  apiKey: env('SWEATER_API_KEY', DEFAULT_CONFIG.apiKey),
  authDomain: env('SWEATER_AUTH_DOMAIN', DEFAULT_CONFIG.authDomain),
  projectId: env('SWEATER_PROJECT_ID', DEFAULT_CONFIG.projectId),
  storageBucket: env('SWEATER_STORAGE_BUCKET', DEFAULT_CONFIG.storageBucket),
  messagingSenderId: env('SWEATER_SENDER_ID', DEFAULT_CONFIG.messagingSenderId),
  appId: env('SWEATER_APP_ID', DEFAULT_CONFIG.appId),
};

/**
 * A kill switch that does not depend on getting a prompt right.
 *
 * `SWEATER_MCP_READONLY=1` refuses every write before it is attempted, so the
 * server can be handed to an assistant for analysis with no possibility of it
 * touching anything — enforced in code, not in instructions.
 */
export const readOnly = ['1', 'true', 'yes'].includes(
  String(process.env.SWEATER_MCP_READONLY ?? '').trim().toLowerCase(),
);

export class SweaterMcpError extends Error {
  constructor(message, { code = 'failed-precondition' } = {}) {
    super(message);
    this.name = 'SweaterMcpError';
    this.code = code;
  }
}

let state = null;

/**
 * Signs in once and caches it. Credentials come from the environment — never
 * from a tool argument, so no prompt can talk this server into using a
 * different account than the one its operator configured.
 */
export async function connect() {
  if (state) return state;

  const email = env('SWEATER_EMAIL');
  const password = env('SWEATER_PASSWORD');
  if (!email || !password) {
    throw new SweaterMcpError(
      'بيانات الدخول مفقودة. اضبط SWEATER_EMAIL و SWEATER_PASSWORD في إعداد الخادم. '
      + 'يُفضَّل حساب مستقل للمساعد (بدور accountant) لا حسابك الشخصي، ليظهر باسمه في سجل التدقيق.',
      { code: 'unauthenticated' },
    );
  }

  const app = initializeApp(config, `sweater-mcp-${config.projectId}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app);

  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    throw new SweaterMcpError(
      `تعذّر تسجيل الدخول بالحساب ${email}: ${e?.code || e?.message || 'خطأ غير معروف'}`,
      { code: 'unauthenticated' },
    );
  }

  // The role the RULES will apply, read from the same document they read —
  // not assumed, and not taken from configuration. A missing document means
  // the account is signed in but not a member, which is a different problem
  // from a wrong password and gets a different message.
  const uid = cred.user.uid;
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) {
    throw new SweaterMcpError(
      `الحساب ${email} يسجّل الدخول لكنه غير مُسجَّل في النظام — لا يوجد users/${uid}. `
      + 'أضِف المستند بدور accountant من التطبيق أو من Firebase Console.',
      { code: 'permission-denied' },
    );
  }

  state = { app, auth, db, functions, uid, email, role: snap.data().role || 'operator' };
  return state;
}

/** Test seam: lets a suite drive the tools against an emulator or a fake. */
export function __setConnection(next) {
  const previous = state;
  state = next;
  return previous;
}

/**
 * The one door to the trusted server — the same `httpsCallable` path the app
 * uses, so every ledger write is validated by the same code with the same
 * role, whether a person or an assistant asked for it.
 */
export async function callServer(name, payload = {}) {
  if (readOnly) {
    throw new SweaterMcpError(
      `الخادم في وضع القراءة فقط (SWEATER_MCP_READONLY)، فلا يُنفَّذ «${name}».`,
      { code: 'permission-denied' },
    );
  }
  const { functions } = await connect();
  try {
    const res = await httpsCallable(functions, name)(payload);
    return res.data;
  } catch (e) {
    const err = new SweaterMcpError(e?.message || 'تعذّر إتمام العملية.', {
      code: e?.code || 'internal',
    });
    if (e?.details?.problems) err.problems = e.details.problems;
    throw err;
  }
}
