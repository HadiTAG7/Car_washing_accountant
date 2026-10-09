import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpath, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { signFromWindowsStore } from '../lib/windows-operations-signing.mjs';

const policyPath = fileURLToPath(new URL('./approved-sender.json', import.meta.url));
const credentialPath = join(homedir(), '.codex', 'automations', 'automation-2', 'sweater_agent_secret.json');

// Only the reviewed explicit sender can invoke this adapter. Windows account
// isolation remains the credential boundary, not JavaScript module privacy.
export async function sign(input) {
  let caller, policy;
  try {
    caller = await realpath(process.argv[1] ?? '');
    policy = JSON.parse(await readFile(policyPath, 'utf8'));
    if (caller !== await realpath(policy.sender) || !Array.isArray(policy.files) || policy.files.length < 2) throw new Error();
    for (const file of policy.files) {
      if (createHash('sha256').update(await readFile(file.path)).digest('hex') !== file.sha256) throw new Error();
    }
  }
  catch { throw new Error('Signing is restricted to the approved operations sender.'); }
  return signFromWindowsStore(input, { credentialPath });
}
