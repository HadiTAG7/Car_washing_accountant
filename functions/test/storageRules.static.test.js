/**
 * Storage rules — a static guard (the Storage emulator is not part of CI).
 *
 * Invoices used to be readable and listable by anyone on the internet. The
 * tokenised download URLs saved in records bypass rules, so nothing needs
 * that openness; this keeps it from coming back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8')
  .replace(/\/\/.*$/gm, '');

describe('storage.rules', () => {
  it('never opens a read or a listing to everyone', () => {
    expect(rules).not.toMatch(/allow\s+[^;]*\b(read|get|list)\b[^;]*:\s*if\s+true\s*;/);
    expect(rules).toMatch(/allow list: if false;/);
  });

  it('a single invoice is readable by staff only, and only an admin writes', () => {
    expect(rules).toMatch(/match \/invoices\/\{allPaths=\*\*\} \{[^}]*allow get: if isStaff\(\);/);
    expect(rules).toMatch(/allow write: if request\.auth != null && isAdminDoc\(\);/);
    expect(rules).toMatch(/role\(\) in \['admin', 'accountant', 'operator'\]/);
  });
});
