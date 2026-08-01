# Contributing to SayIt

Thank you for helping improve SayIt. The project is currently Windows-focused
and keeps selected text and speech synthesis local to the user's machine.

## Before You Start

- Search existing issues before opening a new one.
- Use a feature request to discuss substantial behavior or architecture changes.
- Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Never include private selected text, credentials, signing material, model
  weights, generated runtimes, or unsanitized logs in an issue or commit.

## Development Setup

Requirements:

- Windows with WebView2
- Node.js 24 and npm
- Rust with Cargo and rustfmt
- Python 3.11

Install the frontend and backend dependencies:

```powershell
npm ci
python -m venv python-backend\venv
python-backend\venv\Scripts\python.exe -m pip install --require-hashes -r python-backend\release-tools-requirements.lock.txt
python-backend\venv\Scripts\python.exe -m pip install --require-hashes -r python-backend\packaging-requirements.lock.txt
python-backend\venv\Scripts\python.exe -m pip install --no-cache-dir --no-build-isolation --require-hashes -r python-backend\requirements.lock.txt
python-backend\venv\Scripts\python.exe -m pip install --require-hashes --no-deps -r python-backend\model-requirements.lock.txt
```

Start the development app:

```powershell
npm run tauri dev
```

## Required Checks

Run these before opening a pull request:

```powershell
npm test -- --run
npm run build:frontend
npm run test:release-scripts
python-backend\venv\Scripts\python.exe -m unittest discover -s python-backend -p "test_*.py"

Push-Location src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
Pop-Location
```

Dependency or release-pipeline changes must also pass:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\audit-security.ps1
powershell -ExecutionPolicy Bypass -File scripts\build-python-sidecar.ps1
npm run verify:release-assets
powershell -ExecutionPolicy Bypass -File scripts\generate-sbom.ps1
```

Signed installers and updater artifacts have additional gates documented in
[docs/RELEASE.md](docs/RELEASE.md).

## Pull Requests

- Keep each pull request focused on one coherent change.
- Add or update tests for behavior changes.
- Preserve the local-only privacy boundary unless an approved design explicitly
  changes it.
- Explain user-visible behavior, validation performed, and release implications.
- Do not commit files ignored by `.gitignore`.

By contributing, you agree that your contributions are licensed under the MIT
License in [LICENSE](LICENSE).
