// Reading the export: one JSON document per line, in document-id order.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function readNdjson(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/** Every exported collection: `{ name → rows }`, subcollection rows keyed by their group. */
export function readExport(dir) {
  const out = { collections: {}, groups: {} };
  for (const file of readdirSync(dir).filter(f => f.endsWith('.ndjson')).sort()) {
    if (file === 'auth-users.ndjson' || file === 'storage-files.ndjson' || file === 'firebase-uid-map.ndjson') continue;
    const rows = readNdjson(join(dir, file));
    if (file.startsWith('group__')) out.groups[file.slice(7, -7)] = rows;
    else out.collections[file.slice(0, -7)] = rows;
  }
  out.authUsers = readNdjson(join(dir, 'auth-users.ndjson'));
  out.storageFiles = readNdjson(join(dir, 'storage-files.ndjson'));
  // A backup taken from Supabase (the site's backup button) carries its
  // Firebase → Supabase account map, and ids that are already Supabase's.
  out.uidMapRows = readNdjson(join(dir, 'firebase-uid-map.ndjson'));
  const manifest = join(dir, 'manifest.json');
  out.manifest = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : null;
  out.restore = out.manifest?.source === 'supabase-backup';
  return out;
}
