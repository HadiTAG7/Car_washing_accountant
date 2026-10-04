#!/usr/bin/env python3
"""Read-only preflight. No package install, emulator download or production calls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

KIT = Path(__file__).resolve().parent
BASE = '2465461d961dca583c4eb7f353ce62573276dd40'

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def check(repo, cache, storage=False, cli_root=None, expected_head=None):
    repo, cache = Path(repo).resolve(), Path(cache).resolve()
    manifest = json.loads((KIT / 'manifest.json').read_text(encoding='utf-8'))
    if storage:
        raise RuntimeError('Storage is excluded from this release verification.')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    if not expected_head or not re.fullmatch(r'[0-9a-f]{40}', expected_head) or head != expected_head or head != manifest['candidateSHA']:
        raise RuntimeError('Published test SHA missing or mismatched; stop and ask the coordinator.')
    parents = subprocess.check_output(['git', 'rev-list', '--parents', '-n', '1', 'HEAD'], cwd=repo, text=True).strip().split()
    if parents != [head, BASE]:
        raise RuntimeError('Expected one test commit directly based on the reviewed production SHA.')
    tracked_changes = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repo, text=True).strip()
    if tracked_changes:
        raise RuntimeError('Tracked worktree changes present; use a clean isolated checkout.')
    allowed = set(manifest['patchedFiles'])
    changed = subprocess.check_output(['git', 'diff', '--name-only', BASE, 'HEAD'], cwd=repo, text=True).splitlines()
    if any(name not in allowed and not name.startswith(manifest['kitPath'] + '/') for name in changed):
        raise RuntimeError('Unexpected change outside the reviewed source and test kit.')
    if digest(repo / 'vercel.json') != manifest['sourceConfigSHA256']:
        raise RuntimeError('Release source Vercel configuration differs from the base.')
    for name, sha in manifest['patchedFiles'].items():
        if digest(repo / name) != sha:
            raise RuntimeError('Patched source mismatch: ' + name)
    for name, sha in manifest['lockfiles'].items():
        if digest(repo / name) != sha:
            raise RuntimeError('Lockfile mismatch: ' + name)
    for directory in [repo, repo / 'functions']:
        for p in directory.glob('.env*'):
            if p.name not in ['.env.example', '.env.sample', '.env.template']:
                raise RuntimeError('Isolated test worktree required; an environment file is present.')
    if not shutil.which('node') or not shutil.which('java'):
        raise RuntimeError('Node and Java must already be installed by an authorized operator.')
    node = subprocess.check_output(['node', '--version'], text=True).strip()
    if int(node.removeprefix('v').split('.')[0]) < 20:
        raise RuntimeError('Node >=20 required; cloud verification used 24.19.0.')
    java = subprocess.run(['java', '-version'], capture_output=True, text=True)
    version = re.search(r'version "(\d+)', java.stderr + java.stdout)
    if java.returncode or not version or int(version.group(1)) < 21:
        raise RuntimeError('Java 21+ required. Java 8 is insufficient; do not launch the emulator.')
    cli_base = Path(cli_root).resolve() if cli_root else repo / 'node_modules/firebase-tools'
    cli = cli_base / 'package.json'
    if not cli.exists():
        raise RuntimeError('Missing installed Firebase CLI; supply its authorized --cli-root.')
    cli_version = json.loads(cli.read_text(encoding='utf-8'))['version']
    if cli_version not in ['15.29.0', '15.32.1']:
        raise RuntimeError('Only verified cloud CLI 15.29.0 or authorized MASAH CLI 15.32.1 supported; no automatic install.')
    info = json.loads((cli_base / 'lib/emulator/downloadableEmulatorInfo.json').read_text(encoding='utf-8'))
    for kind in ['firestore'] + (['storage'] if storage else []):
        expected = manifest['emulators'][kind]
        if info[kind]['version'] != expected['version'] or info[kind]['expectedChecksumSHA256'] != expected['sha256']:
            raise RuntimeError('CLI emulator metadata mismatch; no version/binary override allowed.')
        binary = cache / expected['filename']
        if not binary.is_file() or binary.stat().st_size != expected['bytes'] or digest(binary) != expected['sha256']:
            raise RuntimeError('Preinstalled emulator missing or invalid: ' + kind + '. STOP; no automatic download.')
    for name in ['vitest', '@firebase/rules-unit-testing', 'firebase', 'firebase-admin']:
        if not (repo / 'node_modules' / name / 'package.json').is_file():
            raise RuntimeError('Missing preinstalled dependency: ' + name)
    if not (repo / 'functions/node_modules/firebase-functions/package.json').is_file():
        raise RuntimeError('Missing preinstalled Functions dependencies.')
    return {'baseSHA': BASE, 'testSHA': head, 'node': node, 'javaMajor': int(version.group(1)), 'firebaseTools': cli_version, 'cliRoot': str(cli_base),
            'emulators': ['firestore']}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True)
    parser.add_argument('--expected-head', required=True)
    parser.add_argument('--cache', required=True)
    parser.add_argument('--cli-root')
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.repo, args.cache, False, args.cli_root, args.expected_head), indent=2))
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print('STOP: ' + str(error), file=sys.stderr)
        sys.exit(1)
