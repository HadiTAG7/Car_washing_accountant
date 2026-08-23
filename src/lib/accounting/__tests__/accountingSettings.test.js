import { describe, expect, it } from 'vitest';
import { vatRateForWrite } from '../accountingSettings.js';

describe('حمولة إعدادات الضريبة', () => {
  it.each([undefined, null, '', '   ', NaN, Infinity, 'ليس رقماً'])(
    'لا تسمح بخروج NaN من القيمة %s',
    (value) => expect(vatRateForWrite(value)).toBe(0.15),
  );

  it('تحفظ القيم الصريحة', () => {
    expect(vatRateForWrite(0.15)).toBe(0.15);
    expect(vatRateForWrite(0.05)).toBe(0.05);
    expect(vatRateForWrite(0)).toBe(0);
  });
});
