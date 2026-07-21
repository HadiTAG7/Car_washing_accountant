// ═══════════════════════════════════════════════════════════════════════════
// COMPATIBILITY SHIM — kept only so the ~30 component files that import
// from '../lib/supabaseClient' keep working after the migration to Firebase.
//
// The backend is now Firebase (see firebaseClient.js). This module re-exports
// the Firebase equivalents under the old Supabase-era names. New code should
// import from './firebaseClient' directly; these aliases can be cleaned up in
// a follow-up pass that renames the import sites.
// ═══════════════════════════════════════════════════════════════════════════

export {
  isFirebaseConfigured as isSupabaseConfigured,
  missingEnvNames,
  requireAuth,
  isValidEmail,
  lookupUserIdByEmail,
  createPartnerUser,
  uploadInvoiceFile,
  describeBackendError as describeSupabaseError,
  maskedProjectRef as maskedSupabaseUrl,
} from './firebaseClient';
