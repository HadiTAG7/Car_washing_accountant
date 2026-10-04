#!/usr/bin/env python3
"""Run only already installed tools, with a verified existing emulator cache."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import re

KIT = Path(__file__).resolve().parent
module = importlib.util.spec_from_file_location('preflight', KIT / 'preflight.py')
preflight = importlib.util.module_from_spec(module)
module.loader.exec_module(preflight)

def network_test(source):
    """Keep all 51 existing assertions; replace only the fake HTTP response
    adapter with a real loopback HTTP server. The Functions path is unchanged.
    This verifies HTTP transport, not Vercel's deployed hosting runtime."""
    source = "import { createServer } from 'node:http';\n" + source
    source = source.replace("'../../api/ledger.js'", "'../api/ledger.js'")
    source = source.replace("'../src/handlers.js'", "'../functions/src/handlers.js'")
    source = source.replace("'../../src/lib/supervisorAccess.js'", "'../src/lib/supervisorAccess.js'")
    source = source.replace("'./fixtures/supervisor.js'", "'../functions/test/fixtures/supervisor.js'")
    source = source.replace('let app, client, db, auth, functions, tokens = {};', 'let app, client, db, auth, functions, server, origin, tokens = {};')
    replacement = '''async function post(name, data, token) {
  const response = await fetch(origin, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ name, data }) });
  return { statusCode: response.status, body: await response.json() };
}
'''
    source, count = re.subn(r'function post\(name, data, token\) \{.*?\n\}\n', lambda _: replacement, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError('HTTP adapter source changed; stop rather than weakening assertions.')
    start = '''server = createServer(async (req, res) => {
      res.status = code => { res.statusCode = code; return res; };
      res.json = body => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); return res; };
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk.toString();
          if (body.length > 65536) throw new Error('test request too large');
        }
        req.body = body ? JSON.parse(body) : {};
        await handler(req, res);
      } catch {
        if (!res.headersSent) res.status(500).json({ error: { code: 'test-adapter-failure' } });
        else res.end();
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}/api/ledger`;
    __resetAdmin(); app = initAdmin'''
    if '__resetAdmin(); app = initAdmin' not in source or 'afterAll(async () => { __resetAdmin();' not in source:
        raise RuntimeError('HTTP setup changed; stop and review the adapter.')
    source = source.replace('__resetAdmin(); app = initAdmin', start, 1)
    source = source.replace('afterAll(async () => { __resetAdmin();',
        'afterAll(async () => { if (server) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); __resetAdmin();', 1)
    return source

def child(repo, output, storage):
    expected = {'FIRESTORE_EMULATOR_HOST': '127.0.0.1:8080', 'FIREBASE_AUTH_EMULATOR_HOST': '127.0.0.1:9099'}
    if storage:
        expected['FIREBASE_STORAGE_EMULATOR_HOST'] = '127.0.0.1:9199'
    for name, value in expected.items():
        if os.environ.get(name) != value:
            raise RuntimeError('Refuse non-local or missing emulator endpoint: ' + name)
    tests = ['src/lib/accounting/__tests__/supervisor.rules.emulator.test.js',
             '.supervisor-transfer-check/httpApi.callables.test.js']
    if storage:
        tests.append('.supervisor-transfer-check/storage.test.js')
    command = ['node', str(repo / 'node_modules/vitest/vitest.mjs'), 'run', *tests,
               '--no-file-parallelism', '--testTimeout=180000', '--reporter=default',
               '--reporter=json', '--outputFile.json=' + str(output / 'target-results.json')]
    result = subprocess.run(command, cwd=repo)
    if result.returncode:
        return result.returncode
    data = json.loads((output / 'target-results.json').read_text(encoding='utf-8'))
    expected_count = 97 + (6 if storage else 0)
    if data.get('numTotalTests') != expected_count or data.get('numPassedTests') != expected_count or data.get('numFailedTests', 0) or data.get('numPendingTests', 0):
        raise RuntimeError('Incomplete verification: every expected case must execute and pass; skips are not success.')
    print('PASS: all ' + str(expected_count) + ' target cases executed; no skipped cases.')
    return 0

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True)
    parser.add_argument('--expected-head', required=True)
    parser.add_argument('--cache')
    parser.add_argument('--cli-root')
    parser.add_argument('--output', required=True)
    parser.add_argument('--storage', action='store_true')
    parser.add_argument('--child', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    repo, output = Path(args.repo).resolve(), Path(args.output).resolve()
    if args.child:
        return child(repo, output, args.storage)
    if not args.cache:
        raise RuntimeError('Explicit preinstalled cache path required.')
    checked = preflight.check(repo, args.cache, args.storage, args.cli_root, args.expected_head)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'preflight-result.json').write_text(json.dumps(checked, indent=2), encoding='utf-8')
    # Scratch files only. Never overwrite a developer's configuration or test.
    config_path = repo / '.supervisor-transfer.emulators.json'
    scratch = repo / '.supervisor-transfer-check'
    if config_path.exists() or scratch.exists():
        raise RuntimeError('Scratch path already exists; preserve it and stop.')
    config = json.loads((repo / 'firebase.test.json').read_text(encoding='utf-8'))
    for name, port in [('firestore', 8080), ('auth', 9099), ('functions', 5001), ('hub', 4400), ('logging', 4500)]:
        config['emulators'][name] = {'host': '127.0.0.1', 'port': port}
    config['emulators']['ui'] = {'enabled': False}
    # The suites intentionally isolate demo-sweater and demo-supervisor-rules.
    config['emulators']['singleProjectMode'] = False
    if args.storage:
        config['storage'] = {'rules': 'storage.rules'}
        config['emulators']['storage'] = {'host': '127.0.0.1', 'port': 9199}
    env = os.environ.copy()
    for key in list(env):
        if key in ['FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'FIREBASE_CONFIG',
                   'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'] or key.endswith('_EMULATOR_VERSION') or key.endswith('_EMULATOR_BINARY_PATH'):
            env.pop(key, None)
    env.update({'CI': 'true', 'NO_UPDATE_NOTIFIER': '1', 'FIREBASE_EMULATORS_PATH': str(Path(args.cache).resolve()),
                'GCLOUD_PROJECT': 'demo-sweater', 'GOOGLE_CLOUD_PROJECT': 'demo-sweater',
                'VITE_FIREBASE_PROJECT_ID': 'demo-supervisor-unit', 'VITE_FIREBASE_API_KEY': 'fake-api-key',
                'VITE_FIREBASE_AUTH_DOMAIN': 'localhost', 'VITE_FIREBASE_APP_ID': 'test-only-app',
                'VITE_FIREBASE_STORAGE_BUCKET': 'demo-supervisor-unit.appspot.com', 'VITE_FIREBASE_MESSAGING_SENDER_ID': '000000000000'})
    cli = Path(checked['cliRoot']) / 'lib/bin/firebase.js'
    only = 'firestore,auth,functions' + (',storage' if args.storage else '')
    # Firebase emulators:exec takes one shell command. Quote for the receiving OS.
    child_args = [sys.executable, str(KIT / 'run-tests.py'), '--child', '--repo', str(repo), '--expected-head', args.expected_head, '--output', str(output)]
    if args.storage:
        child_args.append('--storage')
    if os.name == 'nt':
        child_command = subprocess.list2cmdline(child_args)
    else:
        import shlex
        child_command = shlex.join(child_args)
    try:
        with tempfile.TemporaryDirectory(prefix='supervisor-cli-config-') as clean_config:
            env['XDG_CONFIG_HOME'] = clean_config
            config_path.write_text(json.dumps(config, indent=2), encoding='utf-8')
            scratch.mkdir()
            source = (repo / 'functions/test/supervisor.httpApi.callables.test.js').read_text(encoding='utf-8')
            (scratch / 'httpApi.callables.test.js').write_text(network_test(source), encoding='utf-8')
            if args.storage:
                shutil.copyfile(KIT / 'storage.test.js', scratch / 'storage.test.js')
            command = ['node', str(cli), 'emulators:exec', '--only', only, '--project', 'demo-sweater', '--config', str(config_path), child_command]
            with (output / 'emulator-run.log').open('w', encoding='utf-8') as log:
                result = subprocess.run(command, cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
            print('Result log: ' + str(output / 'emulator-run.log'))
            return result.returncode
    finally:
        config_path.unlink(missing_ok=True)
        if scratch.exists():
            shutil.rmtree(scratch)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print('STOP: ' + str(error), file=sys.stderr)
        sys.exit(1)
