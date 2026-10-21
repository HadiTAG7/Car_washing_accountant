import { beforeEach, vi } from 'vitest';
import process from 'node:process';
import { __resetReadCache } from './lib/readCache.js';

// The session read cache is module state: each test starts with none.
beforeEach(() => __resetReadCache());
if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  throw new Error('Financial emulator tests require a localhost-only endpoint.');
}
// SDK integration fixtures must use a demo namespace as well as localhost;
// never reuse the production project identity for a local financial test.
if (/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-sweater');
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'synthetic-emulator-key');
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'demo-sweater.firebaseapp.com');
  vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', 'demo-sweater.appspot.com');
}
// jsdom does not implement native dialogs or layout observation.
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
}
