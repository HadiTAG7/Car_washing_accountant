# Run from the published test commit

Follow README_AR.md to fetch the exact branch into a clean isolated worktree. Set EXPECTED_SHA to the full SHA supplied by the coordinator. Preserve LF line endings on Windows (`git -c core.autocrlf=false worktree add`). Product source is already committed; do not apply another patch.

```text
python verification/supervisor/preflight.py --repo <ISOLATED_WORKTREE> --expected-head <EXPECTED_SHA> --cache <EXISTING_EMULATOR_CACHE> --cli-root <AUTHORIZED_FIREBASE_TOOLS_PACKAGE_ROOT>
python verification/supervisor/run-tests.py --repo <ISOLATED_WORKTREE> --expected-head <EXPECTED_SHA> --cache <EXISTING_EMULATOR_CACHE> --cli-root <AUTHORIZED_FIREBASE_TOOLS_PACKAGE_ROOT> --output <NEW_OUTPUT_OUTSIDE_REPOSITORY>
```

Stop if preflight fails. The wrapper checks the existing CLI and emulator binary before launch; do not invoke Firebase directly to circumvent a failure. Add `--storage` only for the authorized, already installed matching Storage runtime. Core success requires 97 passing cases and no skips; with Storage, 103 passing cases and no skips.

The wrapper internally launches `emulators:exec --only firestore,auth,functions --project demo-sweater` with a scratch config binding loopback endpoints. It runs Vitest against the actual supervisor rules suite and a generated network adapter preserving the original 51 HTTP/callable assertions. Optional Storage adds six cases. No deployment, import/export, account activation, package install or emulator download is part of these commands.
