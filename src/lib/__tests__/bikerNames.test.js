import { describe, it, expect } from 'vitest';
import { bikerNameFields, displayBikerName, displayRecordedBikerName, localizedPayrollPreview } from '../bikerNames';
import { mapBiker, toBikerInsert, toBikerUpdate } from '../mappers';
import { washStatsFor } from '../bikerStats';

describe('bilingual biker names', () => {
  it('keeps old Arabic and English-only records readable without a migration', () => {
    expect(bikerNameFields({ name: 'أحمد' })).toEqual({ nameArabic: 'أحمد', nameEnglish: '' });
    expect(bikerNameFields({ name: 'Ahmed' })).toEqual({ nameArabic: '', nameEnglish: 'Ahmed' });
    expect(displayBikerName({ name: 'Ahmed' }, 'ar')).toBe('Ahmed');
  });
  it('selects the requested language and falls back to the other entered name', () => {
    const biker = { name: 'old join key', nameArabic: 'أحمد محمد', nameEnglish: 'Ahmed Mohammed' };
    expect(displayBikerName(biker, 'ar')).toBe('أحمد محمد');
    expect(displayBikerName(biker, 'en')).toBe('Ahmed Mohammed');
    expect(displayBikerName({ ...biker, nameArabic: '' }, 'ar')).toBe('Ahmed Mohammed');
    expect(displayBikerName({ ...biker, nameEnglish: '' }, 'en')).toBe('أحمد محمد');
  });
  it('round-trips both names but preserves the existing wash join key', () => {
    const patch = toBikerUpdate({ nameArabic: '  أحمد محمد  ', nameEnglish: '  Ahmed Mohammed  ' });
    expect(patch).toEqual({ name_ar: 'أحمد محمد', name_en: 'Ahmed Mohammed' });
    const mapped = mapBiker({ id: 'b1', name: 'أحمد', ...patch });
    expect(mapped).toMatchObject({ id: 'b1', name: 'أحمد', nameArabic: 'أحمد محمد', nameEnglish: 'Ahmed Mohammed' });
    expect(washStatsFor(mapped.name, [{ bikerName: 'أحمد', status: 'مكتملة', washDate: '2026-10-01', quantity: 3 }], '2026-10'))
      .toEqual({ washCount: 3, commission: 13.5 });
  });
  it('can create English-only names and trims both fields', () => {
    expect(toBikerInsert({ nameEnglish: '  Ahmed  ' })).toMatchObject({ name: 'Ahmed', name_ar: null, name_en: 'Ahmed' });
    expect(toBikerInsert({ nameArabic: '  أحمد  ', nameEnglish: '  Ahmed  ' }))
      .toMatchObject({ name: 'أحمد', name_ar: 'أحمد', name_en: 'Ahmed' });
  });
  it('unrelated updates neither clear names nor rename a biker', () => {
    expect(toBikerUpdate({ residence: 'السكن' })).toEqual({ residence: 'السكن' });
    expect(toBikerUpdate({ nameEnglish: '' })).toEqual({ name_en: null });
  });
  it('resolves new washes by id, legacy washes by unchanged name and leaves unknown names alone', () => {
    const bikers = [{ id: 'b1', name: 'أحمد', nameArabic: 'أحمد محمد', nameEnglish: 'Ahmed Mohammed' }];
    expect(displayRecordedBikerName({ bikerId: 'b1', bikerName: 'old' }, bikers, 'en')).toBe('Ahmed Mohammed');
    expect(displayRecordedBikerName({ bikerName: ' أحمد ' }, bikers, 'ar')).toBe('أحمد محمد');
    expect(displayRecordedBikerName({ bikerName: 'بديل' }, bikers, 'en')).toBe('بديل');
    expect(displayRecordedBikerName({ bikerId: 'missing', bikerName: 'أحمد' }, bikers, 'en')).toBe('أحمد');
  });
  it('localizes payroll presentation only, not stored snapshots, identities or amounts', () => {
    const preview = { totals: { netDue: 2000 }, lines: [{ bikerId: 'b1', name: 'أحمد', netDue: 2000 }] };
    const display = localizedPayrollPreview(preview, [{ id: 'b1', name: 'أحمد', nameEnglish: 'Ahmed' }], 'en');
    expect(display.lines[0]).toEqual({ bikerId: 'b1', name: 'Ahmed', netDue: 2000 });
    expect(preview.lines[0].name).toBe('أحمد');
    expect(display.totals).toBe(preview.totals);
  });
});
