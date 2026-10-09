import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signFromWindowsStore, WINDOWS_SIGNING_SCRIPT, validateSigningInput, approvedSignerPath } from '../../scripts/lib/windows-operations-signing.mjs';
import { makeOperationsTransport } from '../../scripts/lib/sweater-operations-client.mjs';
import { operationsSigningHash } from '../src/sweater/operationsHttp.js';

const now = 1791540000000;
const input = () => ({ timestamp: String(now / 1000), importRunId: 'diagnostic-v2', bodyHash: 'a'.repeat(64) });
const keyId = 'sk_53a8edfd9cc9407d';
function childFor(output, code = 0, stderr = '') {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = vi.fn();
  queueMicrotask(() => { child.stdout.end(output); child.stderr.end(stderr); child.emit('close', code); });
  return child;
}
const options = spawnImpl => ({ nowMs: now, platform: 'win32', credentialPath: 'C:\\private\\synthetic.json', spawnImpl });

describe('restricted Windows operations signer without secret disclosure', () => {
  it('returns only keyId/signature and sends no plaintext credential in argv/env/stdin', async () => {
    const signResult = { keyId, signature: 'b'.repeat(64) };
    const spawnImpl = vi.fn(() => childFor(JSON.stringify(signResult)));
    expect(await signFromWindowsStore(input(), options(spawnImpl))).toEqual(signResult);
    const [executable, args, config] = spawnImpl.mock.calls[0];
    expect(executable).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(config.windowsHide).toBe(true); expect(config.env).not.toHaveProperty('SWEATER_SECRET');
    expect(args.join(' ')).not.toContain('synthetic.json'); // path goes to stdin, not process list
    expect(WINDOWS_SIGNING_SCRIPT).not.toContain('Out.Write($plain');
    expect(WINDOWS_SIGNING_SCRIPT).toContain('ZeroFreeBSTR');
    expect(WINDOWS_SIGNING_SCRIPT).toContain('Array]::Clear');
    expect(WINDOWS_SIGNING_SCRIPT).toContain('Get-Acl');
    expect(WINDOWS_SIGNING_SCRIPT).toContain('HMACSHA256');
  });
  it.each([
    { ...input(), timestamp: '1' }, { ...input(), timestamp: 'Infinity' },
    { ...input(), importRunId: '../run' }, { ...input(), bodyHash: 'not-a-full-hash' },
    { ...input(), secret: 'never accepted' }, null,
  ])('refuses invalid signing input before opening credentials', async value => {
    const spawnImpl = vi.fn(); await expect(signFromWindowsStore(value, options(spawnImpl))).rejects.toThrow('Signing request refused');
    expect(spawnImpl).not.toHaveBeenCalled();
  });
  it('refuses non-Windows credential access', async () => {
    await expect(signFromWindowsStore(input(), { ...options(vi.fn()), platform: 'linux' })).rejects.toThrow('Windows credential');
  });
  it.each([
    ['raw-secret-do-not-log', 1, 'sensitive decryption diagnostics'],
    [JSON.stringify({ keyId, signature: 'b'.repeat(64), secret: 'no' }), 0, ''],
    [JSON.stringify({ keyId: 'another-key', signature: 'b'.repeat(64) }), 0, ''],
    [JSON.stringify({ keyId, signature: 'bad' }), 0, ''],
  ])('sanitizes child failure and rejects unexpected output', async (output, code, stderr) => {
    try { await signFromWindowsStore(input(), options(() => childFor(output, code, stderr))); expect.fail(); }
    catch (error) { expect(error.message).toBe('Windows credential signing failed; no credential diagnostics are disclosed.');
      expect(error.cause).toBeUndefined(); expect(error.message).not.toMatch(/raw-secret|sensitive|another-key/); }
  });
  it('bounds a stuck child without exposing its output', async () => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = vi.fn();
    await expect(signFromWindowsStore(input(), { ...options(() => child), timeoutMs: 10 })).rejects.toThrow('Windows credential signing failed');
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('pins the approved module to the bundled real file before any import', async () => {
    const modulePath = fileURLToPath(new URL('../../scripts/signers/windows-operations-signer.mjs', import.meta.url));
    expect(await approvedSignerPath(modulePath, { expectedFile: modulePath, sourceFile: modulePath, verifyHelper: false })).toBe(modulePath);
    await expect(approvedSignerPath(fileURLToPath(import.meta.url))).rejects.toThrow('not the approved');
    await expect(approvedSignerPath('relative.mjs')).rejects.toThrow('not the approved');
  });
  it('requires the exact signature input schema and recent timestamp', () => {
    expect(validateSigningInput(input(), now)).toEqual(input());
  });
  it('binds action, coverage and both preview hashes, using a dummy key only', async () => {
    const dummy = 'dummy-test-credential-not-production';
    const payload = { contractVersion: 2, importRunId: 'diagnostic-v2', agentStatus: 'partial', workerLinks: {}, records: [],
      coverage: { rangeFrom: '2026-10-08', rangeTo: '2026-10-08', extractedAt: '2026-10-09T00:00:00Z', pageCount: 1, pagesFetched: 0,
        recordCount: 0, isComplete: false, sourceUrl: 'https://ssp-portal.sweater.sa/', modules: { individual: 'unavailable', corporate: 'unavailable' }, gaps: ['Diagnostic only; no source data read'] } };
    const requests = [ { action: 'preview', payload }, { action: 'status', payload },
      { action: 'save', payload, reviewedPayloadHash: 'a'.repeat(64), previewStateHash: 'b'.repeat(64) },
      { action: 'save', payload, reviewedPayloadHash: 'c'.repeat(64), previewStateHash: 'b'.repeat(64) },
      { action: 'save', payload, reviewedPayloadHash: 'a'.repeat(64), previewStateHash: 'd'.repeat(64) },
      { action: 'preview', payload: { ...payload, coverage: { ...payload.coverage, gaps: ['Different honest diagnostic scope'] } } } ];
    const signatures = [];
    for (const request of requests) {
      const fetchImpl = vi.fn(async (_, config) => { signatures.push(config.headers['x-sweater-signature']);
        expect(JSON.stringify(config)).not.toContain(dummy); return { ok: true, json: async () => ({ result: { dryRun: true } }) }; });
      const sign = async data => ({ keyId, signature: createHmac('sha256', dummy).update(`${data.timestamp}.${data.importRunId}.${data.bodyHash}`).digest('hex') });
      await makeOperationsTransport({ sign, fetchImpl })(request);
      expect(operationsSigningHash(request)).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(new Set(signatures).size).toBe(requests.length);
  });
  it('refuses financial/uncontracted bodies before signing or sending', async () => {
    const sign = vi.fn(), fetchImpl = vi.fn();
    await expect(makeOperationsTransport({ sign, fetchImpl })({ action: 'post_source', payload: {} })).rejects.toThrow('Operational request refused');
    expect(sign).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.runIf(process.platform === 'win32')('signs through real Windows DPAPI with a private dummy fixture, never the production file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sweater-signer-dummy-'));
    const credentialPath = join(directory, 'dummy.json');
    const dummy = 'unit-test-DPAPI-credential-no-production';
    try {
      const setup = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
        $ErrorActionPreference='Stop'; $data=[Console]::In.ReadToEnd() | ConvertFrom-Json;
        $secure=ConvertTo-SecureString $data.dummy -AsPlainText -Force;
        $protected=ConvertFrom-SecureString $secure; $secure.Dispose();
        [IO.File]::WriteAllText($data.path,(@{keyId=$data.keyId;protectedSecret=$protected} | ConvertTo-Json -Compress));
        $acl=New-Object Security.AccessControl.FileSecurity;
        $acl.SetAccessRuleProtection($true,$false);
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
        $acl.SetOwner($sid); $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')));
        Set-Acl -LiteralPath $data.path -AclObject $acl;
        $directoryAcl=New-Object Security.AccessControl.DirectorySecurity;
        $directoryAcl.SetAccessRuleProtection($true,$false); $directoryAcl.SetOwner($sid);
        $directoryAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')));
        Set-Acl -LiteralPath ([IO.Path]::GetDirectoryName($data.path)) -AclObject $directoryAcl;
      `], { input: JSON.stringify({ path: credentialPath, dummy, keyId }), encoding: 'utf8', windowsHide: true,
        env: { SystemRoot: 'C:\\Windows', PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' } });
      expect(setup.status).toBe(0); expect(setup.stdout).toBe('');
      const data = { ...input(), timestamp: String(Math.floor(Date.now() / 1000)) };
      let dummyDiagnostics = '';
      const fixtureSpawn = (executable, args, config) => {
        // Diagnostic instrumentation ONLY for the freshly created dummy file.
        const copied = [...args]; let step = 0;
        copied[copied.length - 1] = copied[copied.length - 1].replace(/throw 'refused'/g, () => `throw 'refused-dummy-step-${++step}'`).replace('} catch { exit 1 }', '} catch { [Console]::Error.Write($_.Exception.Message); exit 1 }');
        const child = spawn(executable, copied, config); child.stderr.on('data', chunk => { dummyDiagnostics += chunk; }); return child;
      };
      const signed = await signFromWindowsStore(data, { credentialPath, spawnImpl: fixtureSpawn }).catch(() => { throw new Error(`Dummy fixture diagnostic: ${dummyDiagnostics}`); });
      expect(signed).toEqual({ keyId, signature: createHmac('sha256', dummy).update(`${data.timestamp}.${data.importRunId}.${data.bodyHash}`).digest('hex') });
      expect(JSON.stringify(signed)).not.toContain(dummy);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 20000);
  it('does not pass signer errors (or credentials) into callers', async () => {
    const sign = vi.fn().mockRejectedValue(new Error('dummy-private-secret'));
    // Valid payload from the full-envelope test above.
    const payload = { contractVersion: 2, importRunId: 'diagnostic-v2', agentStatus: 'partial', workerLinks: {}, records: [], coverage: {
      rangeFrom: '2026-10-08', rangeTo: '2026-10-08', extractedAt: '2026-10-09T00:00:00Z', pageCount: 1, pagesFetched: 0, recordCount: 0,
      isComplete: false, sourceUrl: 'https://ssp-portal.sweater.sa/', modules: { individual: 'unavailable', corporate: 'unavailable' }, gaps: ['No source extraction'] } };
    await expect(makeOperationsTransport({ sign })({ action: 'preview', payload })).rejects.toThrow('Signing unavailable; credential diagnostics are not disclosed.');
  });
});
