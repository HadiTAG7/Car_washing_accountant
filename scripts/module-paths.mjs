import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// URL.pathname is not a filesystem path: it keeps percent encoding and adds
// a leading slash to Windows drive letters. Keep CLI and import use identical.
export const modulePath = (relative, moduleUrl) => fileURLToPath(new URL(relative, moduleUrl));
export const isMainModule = (moduleUrl, entry = process.argv[1]) =>
  Boolean(entry) && pathToFileURL(resolve(entry)).href === moduleUrl;
