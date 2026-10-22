// ملفات SQL المولّدة يجب أن تطابق السجل — من عدّل السجل يعيد التوليد.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { tablesSql } from '../../../../../scripts/migration/generate-schema-sql.mjs';
import { securitySql } from '../../../../../scripts/migration/generate-security-sql.mjs';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
it('migration الجداول محدّث', () => expect(readFileSync(`${root}supabase/migrations/20261022000100_tables.sql`, 'utf8').replace(/\r\n/g, '\n')).toBe(tablesSql()));
it('migration الصلاحيات محدّث', () => expect(readFileSync(`${root}supabase/migrations/20261022000300_security.sql`, 'utf8').replace(/\r\n/g, '\n')).toBe(securitySql()));
