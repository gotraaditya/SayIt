# SayIt

SayIt is a local Windows desktop reader built with Tauri, React, and a local FastAPI/Kokoro TTS backend. Press the global shortcut, SayIt copies the current selection, restores the prior text clipboard value, and reads the selected text aloud from a small always-on-top widget.

![SayIt logo](docs/assets/brand/logo-preview.png)

Read the [project case study](CASE_STUDY.md) for the product problem, interaction design, architecture, validation, trade-offs, and recommended next steps.

## Project Status

SayIt is pre-1.0 software intended for Windows. The source, tests, release
automation, and offline packaging workflow are available, but official
installers should only be published after the signed-release gates in
[`docs/RELEASE.md`](docs/RELEASE.md) pass.

## Requirements

- Windows with WebView2.
- Node.js and npm.
- Rust toolchain with Cargo.
- Python 3.11+ for development.
- TTS dependencies from `python-backend/requirements.lock.txt`.

Install frontend dependencies with:

```powershell
npm ci
```

Install backend dependencies with:

```powershell
python -m venv python-backend\venv
python-backend\venv\Scripts\python.exe -m pip install --require-hashes -r python-backend\release-tools-requirements.lock.txt
python-backend\venv\Scripts\python.exe -m pip install --require-hashes -r python-backend\packaging-requirements.lock.txt
python-backend\venv\Scripts\python.exe -m pip install --no-cache-dir --no-build-isolation --require-hashes -r python-backend\requirements.lock.txt
python-backend\venv\Scripts\python.exe -m pip install --require-hashes --no-deps -r python-backend\model-requirements.lock.txt
```

Release builds must not bundle `python-backend\venv`. Build a fresh CPU-only sidecar from the hash-pinned lockfile and offline Kokoro assets instead:

```powershell
.\scripts\build-python-sidecar.ps1
npm run tauri build
```

The sidecar script installs runtime and model dependencies from hash-pinned
lockfiles, creates `python-backend-runtime\sayit-backend.exe`, downloads
`config.json`, `kokoro-v1_0.pth`, and all supported voice `.pt` files into
`python-backend\models\kokoro`, and writes `SHA256SUMS.txt`.

## Development

Run the desktop app in development:

```powershell
npm run tauri dev
```

The Tauri process starts the Python backend on a random loopback port and exposes that URL to the frontend through a Tauri command. The backend binds to `127.0.0.1` only.

## Testing And Validation

Run frontend unit tests:

```powershell
npm test
```

Run the frontend production build:

```powershell
npm run build
```

Run backend tests without loading the TTS model:

```powershell
python-backend\venv\Scripts\python.exe -m unittest discover -s python-backend -p "test_*.py"
```

Run Rust checks:

```powershell
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Run the full production bundle:

```powershell
npm run tauri build
```

## Architecture

- `src/App.tsx`: Tauri frontend, widget UI, settings, playback state, hotkey event handling, and audio playback.
- `src/textProcessing.ts`: text splitting and caption group helpers used before synthesis.
- `src-tauri/src/lib.rs`: tray, global shortcut registration, selected-text capture, clipboard restoration, backend process launch, and Tauri commands.
- `python-backend/app.py`: local FastAPI service that validates synthesis requests and streams WAV audio from Kokoro.

## Privacy And Security

- Selected text is sent only to the local backend at `127.0.0.1`.
- The backend disables public OpenAPI/docs endpoints and does not return Python tracebacks to clients.
- CORS is restricted to the Tauri/dev origins used by the app.
- Synthesis requests reject empty text, unsupported voices, oversized chunks, and unexpected JSON fields.
- The Tauri app uses a CSP that blocks remote scripts and permits only local loopback backend calls plus blob audio playback.
- The app uses the Windows clipboard sequence number to confirm selection capture, serializes capture requests, and restores cloneable clipboard formats after copying selected text.

## Limitations

- The first read can be slow while the Kokoro model loads.
- The packaged runtime currently targets Windows.
- Very large selections are rejected in the frontend; long valid selections are split into bounded backend chunks.
- If the backend model fails to load, the UI reports that the speech service is unavailable.

## Troubleshooting

- If audio never starts in development, run the backend tests and check that `python-backend\venv` has the pinned requirements installed.
- If audio never starts in a packaged build, run `.\scripts\build-python-sidecar.ps1` and confirm `python-backend\models\kokoro\SHA256SUMS.txt` lists the model and all supported voices.
- If the global shortcut does not work, choose a shortcut with at least one modifier and avoid reserved combinations such as `Ctrl+C`, `Ctrl+V`, `Alt+Tab`, or `Alt+F4`.
- If packaging fails, install the Tauri Windows build prerequisites and rerun `npm run tauri build`.
- If the app cannot contact the backend, confirm no security software is blocking loopback connections to `127.0.0.1`.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening an issue or pull request. Report suspected vulnerabilities privately
using [SECURITY.md](SECURITY.md).

## License

SayIt is licensed under the [MIT License](LICENSE). Bundled dependencies and
model assets retain their respective licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
