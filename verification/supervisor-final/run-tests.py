#!/usr/bin/env python3
"""Four local Firestore cases only; verified installed tools, no downloads/deployment."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile

KIT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('preflight', KIT / 'preflight.py')
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

def child(repo, output):
    if os.environ.get('FIRESTORE_EMULATOR_HOST') != '127.0.0.1:8080' or os.environ.get('GCLOUD_PROJECT') != 'demo-sweater':
        raise RuntimeError('Refuse missing/non-local emulator or non-demo project.')
    manifest = json.loads((KIT / 'manifest.json').read_text(encoding='utf-8'))
    command = ['node', str(repo / 'node_modules/vitest/vitest.mjs'), 'run', *manifest['expectedTests'],
               '--no-file-parallelism', '--testTimeout=180000', '--reporter=default', '--reporter=json',
               '--outputFile.json=' + str(output / 'target-results.json')]
    result = subprocess.run(command, cwd=repo)
    if result.returncode:
        return result.returncode
    data = json.loads((output / 'target-results.json').read_text(encoding='utf-8'))
    if data.get('numTotalTests') != 4 or data.get('numPassedTests') != 4 or data.get('numFailedTests', 0) or data.get('numPendingTests', 0):
        raise RuntimeError('Every one of the four cases must execute and pass; no skips.')
    for filename, count in manifest['expectedTests'].items():
        result = next((row for row in data['testResults'] if row['name'].replace('\\', '/').endswith('/' + filename)), None)
        if not result or len(result['assertionResults']) != count or any(case['status'] != 'passed' for case in result['assertionResults']):
            raise RuntimeError('Incomplete suite: ' + filename)
    print('PASS: 4/4 affected Firestore cases executed; no skips.')
    return 0

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True)
    parser.add_argument('--expected-head', required=True)
    parser.add_argument('--cache')
    parser.add_argument('--cli-root')
    parser.add_argument('--output', required=True)
    parser.add_argument('--child', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    repo, output = Path(args.repo).resolve(), Path(args.output).resolve()
    if args.child:
        return child(repo, output)
    if not args.cache:
        raise RuntimeError('Explicit verified existing emulator cache required.')
    checked = preflight.check(repo, args.cache, False, args.cli_root, args.expected_head)
    output.mkdir(parents=True, exist_ok=False)
    (output / 'preflight-result.json').write_text(json.dumps(checked, indent=2), encoding='utf-8')
    config_path = repo / '.supervisor-final.emulators.json'
    scratch = repo / '.supervisor-final-check'
    if config_path.exists() or scratch.exists():
        raise RuntimeError('Existing scratch path: preserve it and stop.')
    config = {'firestore': {'rules': 'firestore.test.rules'}, 'emulators': {
        'firestore': {'host': '127.0.0.1', 'port': 8080}, 'hub': {'host': '127.0.0.1', 'port': 4400},
        'logging': {'host': '127.0.0.1', 'port': 4500}, 'ui': {'enabled': False}, 'singleProjectMode': False}}
    env = os.environ.copy()
    for key in list(env):
        if key in ['FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'FIREBASE_CONFIG',
                   'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'] or key.endswith('_EMULATOR_VERSION') or key.endswith('_EMULATOR_BINARY_PATH'):
            env.pop(key, None)
    env.update({'CI': 'true', 'NO_UPDATE_NOTIFIER': '1', 'FIREBASE_EMULATORS_PATH': str(Path(args.cache).resolve()),
                'GCLOUD_PROJECT': 'demo-sweater', 'GOOGLE_CLOUD_PROJECT': 'demo-sweater'})
    child_args = [sys.executable, str(KIT / 'run-tests.py'), '--child', '--repo', str(repo), '--expected-head', args.expected_head, '--output', str(output)]
    child_command = subprocess.list2cmdline(child_args) if os.name == 'nt' else shlex.join(child_args)
    try:
        with tempfile.TemporaryDirectory(prefix='supervisor-final-cli-') as clean_config:
            env['XDG_CONFIG_HOME'] = clean_config
            config_path.write_text(json.dumps(config, indent=2), encoding='utf-8')
            scratch.mkdir()
            shutil.copyfile(KIT / 'scopedHandoff.emulator.test.js', scratch / 'scopedHandoff.emulator.test.js')
            cli = Path(checked['cliRoot']) / 'lib/bin/firebase.js'
            command = ['node', str(cli), 'emulators:exec', '--only', 'firestore', '--project', 'demo-sweater', '--config', str(config_path), child_command]
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
