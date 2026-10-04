// Offline review only. No network client, credentials or import action.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { reviewSweaterHandoff, HANDOFF_MAX_BYTES } from '../src/lib/sweater/handoff.js';
import { canonicalJson } from '../functions/src/sweater/record.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/review-sweater-handoff.mjs input.json review-output.json');
  process.exitCode = 2;
} else {
  try {
    if ((await stat(input)).size > HANDOFF_MAX_BYTES) throw new Error('حد الملف ٢ ميغابايت.');
    const parsed = JSON.parse(await readFile(input, 'utf8'));
    const review = reviewSweaterHandoff(parsed);
    const { payload, ...report } = review;
    const reviewedPayloadHash = payload ? createHash('sha256').update(canonicalJson(payload)).digest('hex') : null;
    await writeFile(output, JSON.stringify({ offlineOnly: true, comparedWithStoredBookings: false,
      ...report, reviewedPayloadHash }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(review.ready ? 'Ready for authenticated dryRun; no records imported.' : 'Blocked: review report lists missing/invalid fields; nothing sent.');
    if (!review.ready) process.exitCode = 1;
  } catch {
    console.error('Review failed: check JSON, file size and a new output filename. No network request was made.');
    process.exitCode = 2;
  }
}
