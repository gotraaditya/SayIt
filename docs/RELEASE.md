# Release Process

SayIt releases must pass these gates before MSI/NSIS artifacts are published.

## Required Gates

1. `npm ci`
2. `powershell -ExecutionPolicy Bypass -File scripts/build-python-sidecar.ps1`
3. `npm run verify:release-assets`
4. `npm test -- --run`
5. `python-backend\venv\Scripts\python.exe -m unittest discover -s python-backend -p "test_*.py"`
6. `cd src-tauri && cargo test`
7. `cargo install cargo-audit`
8. `powershell -ExecutionPolicy Bypass -File scripts/audit-security.ps1`
9. `powershell -ExecutionPolicy Bypass -File scripts/generate-sbom.ps1`
10. `npm run generate:release-config`
11. `npx tauri build --config release\tauri.release.conf.json`
12. `npm run verify:release-bundles`
13. `powershell -ExecutionPolicy Bypass -File scripts/clean-machine-smoke.ps1 -InstallerPath <path> -FreshMachine -InstalledSuccessfully -NetworkDisconnected -SingleInstanceValidated -OfflineSpeechValidated -AllVoicesValidated -BackendRestartValidated -BackendExitValidated`
14. `npm run verify:release-readiness`

The tag/manual release workflow in `.github/workflows/release.yml` runs these
gates on Windows and expects the `release` GitHub environment to provide the
signing and updater secrets listed below. It runs
`scripts/verify-release-readiness.ps1 -SkipCleanMachineSmoke` before building
signed bundles because clean-machine smoke evidence can only be generated after
an installer exists. Run the full `npm run verify:release-readiness` before
promoting a signed artifact to a public channel.
Release readiness checks that both the CI and release workflow files are present
and still contain the critical test, audit, SBOM, sidecar, signing, bundle, and
artifact upload gates.

Backend test environments and release sidecar builds must install from
`python-backend\requirements.lock.txt` with `--require-hashes`. The audit and
SBOM scripts fail the release if npm, Rust, or Python evidence cannot be
generated.

Release readiness also requires a real Git `HEAD` commit. In GitHub Actions it
checks that `HEAD` matches `GITHUB_SHA`, so published artifacts can be traced
back to the reviewed source revision.

`npm run verify:release-bundles` runs after Tauri build and rejects stale or
unsigned release outputs. It requires Windows installers to be at least 50 MB,
have valid Authenticode signatures, and have signed updater archives.

## Code Signing

Windows release artifacts must be signed outside source control with a
certificate supplied by CI secrets. `src-tauri/tauri.conf.json` routes Windows
binary signing through `scripts/sign-windows.ps1`, which fails closed unless
signing material is present or `SAYIT_ALLOW_UNSIGNED=1` is explicitly set for a
local-only build.

- `SAYIT_SIGN_CERT_PATH`
- `SAYIT_SIGN_CERT_BASE64`
- `SAYIT_SIGN_CERT_PASSWORD`
- `SAYIT_SIGN_CERT_THUMBPRINT`
- `SAYIT_SIGN_TIMESTAMP_URL`

Unsigned artifacts must not be promoted beyond local testing. Release readiness
fails if `SAYIT_ALLOW_UNSIGNED=1` is present.

## Automatic Updates

Tauri updater artifacts are enabled in `src-tauri/tauri.conf.json`, and the app
performs a startup update check through `@tauri-apps/plugin-updater`. Store the
private updater key in CI as one of:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PATH`
- `SAYIT_UPDATE_ENDPOINT`

Store `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key is password-protected.
The public key is committed in Tauri config. The base config intentionally has
no updater endpoint; `scripts/generate-release-config.ps1` writes
`release\tauri.release.conf.json` from `SAYIT_UPDATE_ENDPOINT`, and release
builds must pass it to Tauri with `--config`.

`npm run verify:release-readiness` fails if the updater feed still points at a
placeholder, reserved test, or local host, if signing secrets are missing or
still look like placeholders, if the Git worktree has tracked uncommitted
changes, if SBOMs or vulnerability audit reports are missing, or if the
clean-machine smoke report has not confirmed the offline/restart/exit checks.
Smoke evidence is tied to the installer hash and size; the smoke script rejects
non-installer paths and artifacts smaller than the offline backend bundle. It
also records the Git commit used for the build, and release readiness rejects
smoke reports whose `sourceCommit` does not match the current `HEAD`.

## Release Channels

- `dev`: local builds only.
- `preview`: signed builds for clean-machine validation.
- `stable`: signed builds promoted only after preview smoke testing.

Rollback means removing the latest stable manifest entry and restoring the last
known-good signed artifact.

## Crash Diagnostics

Backend stderr and app logs are written to the app log directory as
`sayit-backend.log`. Desktop lifecycle events, shortcut capture errors, backend
restart failures, and Rust panic messages are appended to `sayit-desktop.log` in
the same directory. Crash uploads must remain opt-in until privacy review is
complete.
