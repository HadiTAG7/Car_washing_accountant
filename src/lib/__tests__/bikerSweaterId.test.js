import { describe, expect, it } from 'vitest';
import { mapBiker, toBikerUpdate } from '../mappers';

describe('Sweater worker identifier display', () => {
  it('reads the existing external identifier, not the internal document or iqama number', () => {
    expect(mapBiker({ id: 'internal-document', driver_external_id: '001986', iqama_number: '1234567890' }).driverExternalId).toBe('001986');
    expect(mapBiker({ id: 'internal-document', iqama_number: '1234567890' }).driverExternalId).toBe('');
  });
  it('accepts numeric IDs without adding them to editable updates', () => {
    expect(mapBiker({ id: 'internal', driver_external_id: 1986 }).driverExternalId).toBe('1986');
    expect(toBikerUpdate({ driverExternalId: 'different', currentStatus: 'تدريب' })).toEqual({ current_status: 'تدريب' });
  });
});
