# Third-Party Notices

SayIt bundles open-source dependencies from the Rust, npm, and Python
ecosystems. Release builds also bundle Kokoro model assets from
`hexgrad/Kokoro-82M`.

Before publishing a release:

1. Run `powershell -ExecutionPolicy Bypass -File scripts/generate-sbom.ps1`.
2. Review `python-backend/models/kokoro/KOKORO_LICENSE_NOTICE.txt`.
3. Attach the generated SBOM files to the release.
4. Keep dependency license metadata with the release artifacts.

The generated SBOM files are the authoritative third-party inventory for each
release.
