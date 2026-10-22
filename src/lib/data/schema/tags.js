// Tagged Firestore types in JSON: { "$fs:<kind>": payload }. See
// scripts/migration/firestoreCodec.mjs for the export side.
export const TAG = '$fs:';
export function tagOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0].startsWith(TAG) ? keys[0].slice(TAG.length) : null;
}
