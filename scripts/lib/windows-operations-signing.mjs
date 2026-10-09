import { spawn } from 'node:child_process';
import { realpath, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXISTING_OPERATIONS_KEY_ID = 'sk_53a8edfd9cc9407d'; // public identifier, never a credential
const SIGNER_FILE = fileURLToPath(new URL('../signers/windows-operations-signer.mjs', import.meta.url));
const PRIVATE_SIGNER = join(homedir(), '.codex', 'automations', 'automation-2', 'operations-v2', 'signers', 'windows-operations-signer.mjs');
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const MODULES = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules';
const failure = () => new Error('Windows credential signing failed; no credential diagnostics are disclosed.');

export async function approvedSignerPath(candidate, { expectedFile = PRIVATE_SIGNER, sourceFile = SIGNER_FILE, verifyHelper = true } = {}) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) throw new Error('Signing module is not the approved bundled adapter.');
  try {
    const [supplied, approved] = await Promise.all([realpath(candidate), realpath(expectedFile)]);
    if (supplied !== approved) throw new Error();
    const digest = value => createHash('sha256').update(value).digest('hex');
    if (digest(await readFile(supplied)) !== digest(await readFile(sourceFile))) throw new Error();
    if (verifyHelper && digest(await readFile(join(dirname(supplied), '..', 'lib', 'windows-operations-signing.mjs')))
      !== digest(await readFile(fileURLToPath(import.meta.url)))) throw new Error();
    return approved;
  } catch { throw new Error('Signing module is not the approved bundled adapter.'); }
}

export function validateSigningInput(input, nowMs = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 3 || !Object.keys(input).every(k => ['timestamp', 'importRunId', 'bodyHash'].includes(k))
    || typeof input.timestamp !== 'string' || !/^\d{10}$/.test(input.timestamp)
    || Math.abs(nowMs / 1000 - Number(input.timestamp)) > 300
    || typeof input.importRunId !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,159}$/.test(input.importRunId)
    || typeof input.bodyHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.bodyHash)) throw new Error('Signing request refused before credential access.');
  return input;
}

// The trusted child reads and decrypts the existing Windows-user DPAPI file.
// Plaintext NEVER leaves that child: stdout contains only {keyId,signature}.
// No network, source writes, environment secret, rotation or secret export.
export const WINDOWS_SIGNING_SCRIPT = String.raw`
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
$ptr=[IntPtr]::Zero; $secure=$null; $keyBytes=$null; $messageBytes=$null; $mac=$null; $hash=$null;
try {
  $r=[Console]::In.ReadToEnd() | ConvertFrom-Json;
  if ($r.timestamp -notmatch '^\d{10}$' -or $r.importRunId -notmatch '^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,159}$' -or $r.bodyHash -notmatch '^[a-f0-9]{64}$') { throw 'refused' };
  $now=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); if ([Math]::Abs($now-[long]$r.timestamp) -gt 300) { throw 'refused' };
  $file=Get-Item -LiteralPath $r.credentialPath -Force;
  if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'refused' };
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
  $allowed=@($user,'S-1-5-18','S-1-5-32-544');
  $acl=Get-Acl -LiteralPath $file.FullName;
  if ($allowed -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'refused' };
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value) { throw 'refused' };
  };
  $parent=$file.Directory;
  if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'refused' };
  foreach ($rule in (Get-Acl -LiteralPath $parent.FullName).GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value -and ($rule.FileSystemRights -band 0x000d0116)) { throw 'refused' };
  };
  $credentials=[IO.File]::ReadAllText($file.FullName) | ConvertFrom-Json;
  if ($credentials.keyId -cne $r.expectedKeyId -or -not $credentials.protectedSecret) { throw 'refused' };
  $secure=ConvertTo-SecureString $credentials.protectedSecret;
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);
  $keyBytes=[Text.Encoding]::UTF8.GetBytes([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr));
  $messageBytes=[Text.Encoding]::UTF8.GetBytes(($r.timestamp+'.'+$r.importRunId+'.'+$r.bodyHash));
  $mac=New-Object Security.Cryptography.HMACSHA256; $mac.Key=$keyBytes;
  $hash=$mac.ComputeHash($messageBytes);
  $signature=([BitConverter]::ToString($hash)).Replace('-','').ToLowerInvariant();
  [Console]::Out.Write((@{keyId=$r.expectedKeyId;signature=$signature} | ConvertTo-Json -Compress));
} catch { exit 1 }
finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) };
  if ($secure) { $secure.Dispose() }; if ($mac) { $mac.Dispose() };
  if ($keyBytes) { [Array]::Clear($keyBytes,0,$keyBytes.Length) };
  if ($messageBytes) { [Array]::Clear($messageBytes,0,$messageBytes.Length) };
  if ($hash) { [Array]::Clear($hash,0,$hash.Length) };
}`;

export async function signFromWindowsStore(input, { credentialPath, spawnImpl = spawn, platform = process.platform,
  nowMs = Date.now(), timeoutMs = 15000 } = {}) {
  validateSigningInput(input, nowMs);
  if (platform !== 'win32') throw new Error('Windows credential store is required; no plaintext fallback exists.');
  if (!isAbsolute(credentialPath ?? '')) throw failure();
  return new Promise((resolve, reject) => {
    let child, timer, settled = false, output = '';
    const stop = () => { if (settled) return; settled = true; clearTimeout(timer); output = ''; child?.kill(); reject(failure()); };
    try {
      child = spawnImpl(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_SIGNING_SCRIPT], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        // Do not forward the application's env credentials or hostile module paths.
        env: { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', PSModulePath: MODULES },
      });
      timer = setTimeout(stop, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { output += chunk; if (Buffer.byteLength(output) > 1024) stop(); });
      // Drain/discard diagnostics. Do not collect or include them in errors.
      child.stderr.resume(); child.stdin.on('error', stop); child.on('error', stop);
      child.on('close', code => {
        if (settled) return;
        if (code !== 0) return stop();
        try {
          const result = JSON.parse(output);
          if (Object.keys(result).length !== 2 || result.keyId !== EXISTING_OPERATIONS_KEY_ID
            || typeof result.signature !== 'string' || !/^[a-f0-9]{64}$/.test(result.signature)) return stop();
          settled = true; clearTimeout(timer); output = ''; resolve({ keyId: result.keyId, signature: result.signature });
        } catch { stop(); }
      });
      child.stdin.end(JSON.stringify({ ...input, credentialPath, expectedKeyId: EXISTING_OPERATIONS_KEY_ID }));
    } catch { stop(); }
  });
}
