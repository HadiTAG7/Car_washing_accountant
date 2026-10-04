import { expect, it } from 'vitest';
import { formatDateOnly } from '../dateOnly';
it.each(['Pacific/Honolulu', 'America/Los_Angeles', 'Asia/Riyadh', 'Pacific/Kiritimati'])('keeps 3/4 October calendar days in %s', zone => {
  const previous = process.env.TZ; process.env.TZ = zone;
  try { expect(formatDateOnly('2026-10-03', 'en-GB')).toBe('3 October 2026'); expect(formatDateOnly('2026-10-04', 'en-GB')).toBe('4 October 2026'); }
  finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
