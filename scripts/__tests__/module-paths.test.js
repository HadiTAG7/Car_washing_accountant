import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { modulePath, isMainModule } from '../module-paths.mjs';

it('decodes Arabic, spaces and URL-special characters as filesystem paths', () => {
  const file = resolve('مسار تجربة', 'ملف #100%.mjs');
  expect(modulePath('.', pathToFileURL(file).href)).toBe(join(resolve('مسار تجربة'), '/'));
});

it('recognizes a direct CLI entry without treating an import as execution', () => {
  const entry = resolve('مسار تجربة', 'ملف.mjs');
  expect(isMainModule(pathToFileURL(entry).href, entry)).toBe(true);
  expect(isMainModule(pathToFileURL(entry).href, resolve('different.mjs'))).toBe(false);
  expect(isMainModule(pathToFileURL(entry).href, '')).toBe(false);
});

it.each(['generate-schema-sql.mjs', 'generate-security-sql.mjs'])('runs %s --check as a real CLI on the host platform', script => {
  const root = modulePath('../../', import.meta.url);
  const output = execFileSync(process.execPath, [join(root, 'scripts', 'migration', script), '--check'], {cwd:root, encoding:'utf8'});
  expect(output).toContain('محدّث ✓');
});
