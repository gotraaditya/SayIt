# SayIt Code Map

Use this map as a first stop when changing SayIt. Keep new behavior near the module that owns the responsibility instead of adding it to the top-level app files by default.

## Frontend

- `src/App.tsx` coordinates React state, playback flow, settings flow, and event wiring.
- `src/backendClient.ts` owns backend configuration lookup, HTTP synthesis requests, retries, and cancellation.
- `src/tauriWindows.ts` owns Tauri window labels, resizing, hiding, dragging, and settings-window placement.
- `src/components/CompactWidget.tsx` renders the compact reading surface.
- `src/components/SettingsWindow.tsx` renders the settings surface.
- `src/textProcessing.ts` owns selected-text limits, synthesis chunking, and caption group construction.
- `src/captions.ts` owns visual caption line wrapping.
- `src/shortcut.ts` owns shortcut formatting and validation.
- `src/updateFlow.ts` owns update installation flow.
- `src/appConstants.ts` contains shared UI, backend retry, and voice constants.

## Desktop Shell

- `src-tauri/src/lib.rs` owns Tauri commands, global shortcut handling, backend process supervision, update status, and platform integration.
- `src-tauri/src/main.rs` is the minimal Tauri entry point.

## Python Backend

- `python-backend/app.py` owns FastAPI routes, auth, Kokoro model loading, synthesis validation, job cancellation, and backend health.
- `python-backend/backend_server.py` owns the packaged sidecar process entry point, parent-process monitoring, backend URL announcement, and Uvicorn startup.
- `python-backend/loopback.py` owns loopback socket creation and requested-port fallback behavior shared by backend entry points.

## Release And Packaging

- `scripts/build-python-sidecar.ps1` builds the Python sidecar and bundles required runtime/model assets.
- `scripts/verify-release-readiness.ps1`, `scripts/verify-release-bundles.ps1`, and `scripts/verify-release-assets.mjs` are the release verification gates.
- `python-backend-runtime/` contains packaged backend runtime output.

## Verification

- Frontend unit tests: `npm test`
- Frontend typecheck and bundle: `npm run build:frontend`
- Rust/Tauri tests: run `cargo test` from `src-tauri/`
- Backend tests with project dependencies: `python-backend/venv/Scripts/python.exe -m unittest discover -s python-backend -p "test_*.py"`
