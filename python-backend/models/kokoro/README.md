This directory is populated by `scripts/build-python-sidecar.ps1`.

Release builds require these offline Kokoro assets:

- `config.json`
- `kokoro-v1_0.pth`
- `voices/af_alloy.pt`
- `voices/af_bella.pt`
- `voices/af_heart.pt`
- `voices/af_jessica.pt`
- `voices/af_nicole.pt`
- `voices/af_sky.pt`
- `voices/am_adam.pt`
- `voices/am_echo.pt`
- `voices/am_fenrir.pt`
- `voices/am_michael.pt`
- `voices/am_onyx.pt`

The build script also writes `SHA256SUMS.txt` and `KOKORO_LICENSE_NOTICE.txt`
next to the model.
