import { expect, it } from 'vitest';
import { recordedBikerSweaterId } from '../bikerNames';

it('uses the linked worker Sweater ID even when its display name changes', () => {
  expect(recordedBikerSweaterId({ bikerId: 'internal-1', bikerName: 'Old name' }, [{ id: 'internal-1', name: 'New name', driverExternalId: '001986' }])).toBe('001986');
});
it('does not replace a missing link with another worker or an internal document number', () => {
  expect(recordedBikerSweaterId({ bikerId: 'missing', bikerName: 'Same name' }, [{ id: 'other', name: 'Same name', driverExternalId: '1986' }])).toBe('');
  expect(recordedBikerSweaterId({ bikerId: 'internal-1' }, [{ id: 'internal-1', name: 'Worker (1986)' }])).toBe('');
});
it('allows only unambiguous legacy name matches', () => {
  const record = { bikerName: ' Worker ' };
  const bikers = [{ id: 'a', name: 'Worker', driverExternalId: '1986' }];
  expect(recordedBikerSweaterId(record, bikers)).toBe('1986');
  expect(recordedBikerSweaterId(record, [...bikers, { id: 'b', name: 'Worker', driverExternalId: '1990' }])).toBe('');
});
