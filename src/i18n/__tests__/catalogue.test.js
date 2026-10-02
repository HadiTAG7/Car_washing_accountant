import { describe, expect, it } from 'vitest';
import { collectEnglishMessages } from '../../../scripts/english-messages.mjs';
import generated from '../en.generated.json';
import reviewed from '../en.reviewed.json';

describe('English catalogue completeness', () => {
  const catalogue = { ...generated, ...reviewed };
  it('covers developer-authored Arabic UI and backend messages', async () => {
    const messages = await collectEnglishMessages();
    expect([...messages].filter(source => !catalogue[source]?.trim())).toEqual([]);
  });
  it('retains every interpolation in every translated template', () => {
    const incomplete = Object.entries(catalogue).filter(([source, english]) =>
      (source.match(/\[VAR\d+\]/g) || []).some(variable => !english.includes(variable)));
    expect(incomplete).toEqual([]);
  });
});
