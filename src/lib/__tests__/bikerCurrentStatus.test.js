import { describe, expect, it } from 'vitest';
import { mapBiker, toBikerInsert, toBikerUpdate } from '../mappers';
import { bikerCurrentStatusLabel } from '../bikerCurrentStatus';

describe('current worker status persistence', () => {
  it('round-trips a custom status without changing salary or employment dates', () => {
    const saved = toBikerInsert({ name: 'Test worker', salary: 900, currentStatus: '  بانتظار الاختبار  ' });
    expect(saved.current_status).toBe('بانتظار الاختبار');
    expect(mapBiker({ id: 'test', ...saved })).toMatchObject({
      currentStatus: 'بانتظار الاختبار', salary: 900, startDate: '', endDate: '',
    });
  });
  it('does not infer a status for old workers and allows clearing it', () => {
    expect(mapBiker({ id: 'old', name: 'Old worker' }).currentStatus).toBe('');
    expect(toBikerUpdate({ currentStatus: '' })).toEqual({ current_status: null });
  });
  it('a status-only update touches no financial or identity fields', () => {
    expect(toBikerUpdate({ currentStatus: '  هرب  ' })).toEqual({ current_status: 'هرب' });
    expect(toBikerUpdate({ salary: 900 })).toEqual({ salary: 900 });
  });
  it('shows known statuses in either language without translating custom text', () => {
    expect(bikerCurrentStatusLabel('تدريب', 'en')).toBe('Training');
    expect(bikerCurrentStatusLabel('Working', 'ar')).toBe('يشتغل');
    expect(bikerCurrentStatusLabel('تجربة خاصة', 'en')).toBe('تجربة خاصة');
    expect(bikerCurrentStatusLabel('', 'ar')).toBe('غير محددة');
    expect(bikerCurrentStatusLabel('', 'en')).toBe('Not specified');
  });
});
