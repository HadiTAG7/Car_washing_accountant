// ملفات SQL المولّدة يجب أن تطابق السجل — من عدّل السجل يعيد التوليد.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { tablesSql } from '../../../../../scripts/migration/generate-schema-sql.mjs';
import { securitySql } from '../../../../../scripts/migration/generate-security-sql.mjs';

const root = new URL('../../../../../', import.meta.url).pathname;
it('migration الجداول محدّث', () => expect(readFileSync(`${root}supabase/migrations/20261022000100_tables.sql`, 'utf8')).toBe(tablesSql()));
it('migration الصلاحيات محدّث', () => expect(readFileSync(`${root}supabase/migrations/20261022000300_security.sql`, 'utf8')).toBe(securitySql()));
