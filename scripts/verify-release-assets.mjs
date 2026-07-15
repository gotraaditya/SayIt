import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const requiredVoices = [
  "af_alloy",
  "af_bella",
  "af_heart",
  "af_jessica",
  "af_nicole",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_fenrir",
  "am_michael",
  "am_onyx",
];

const requiredFiles = [
  join(root, "LICENSE"),
  join(root, "THIRD_PARTY_NOTICES.md"),
  join(root, "python-backend-runtime", "sayit-backend.exe"),
  join(root, "python-backend", "models", "kokoro", "SHA256SUMS.txt"),
];
const requiredModelFiles = [
  "config.json",
  "kokoro-v1_0.pth",
  "KOKORO_LICENSE_NOTICE.txt",
  "README.md",
  ...requiredVoices.map((voice) =>
    `voices/${voice}.pt`
  ),
];
const modelsDir = join(root, "python-backend", "models", "kokoro");
requiredFiles.push(...requiredModelFiles.map((path) => join(modelsDir, path)));

const missing = requiredFiles.filter((path) => !existsSync(path));
const tauriConfigPath = join(root, "src-tauri", "tauri.conf.json");
const tauriConfig = readFileSync(tauriConfigPath, "utf8");
const parsedTauriConfig = JSON.parse(tauriConfig);
const capabilityText = readFileSync(join(root, "src-tauri", "capabilities", "default.json"), "utf8");
const parsedCapability = JSON.parse(capabilityText.replace(/^\uFEFF/, ""));
const cargoManifestText = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
const packageManifestText = readFileSync(join(root, "package.json"), "utf8");
const packageLockText = readFileSync(join(root, "package-lock.json"), "utf8");
const ciWorkflowText = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
const releaseWorkflowText = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8");
const backendAppText = readFileSync(join(root, "python-backend", "app.py"), "utf8");
const appFrontendText = readFileSync(join(root, "src", "App.tsx"), "utf8");
const updateFlowText = readFileSync(join(root, "src", "updateFlow.ts"), "utf8");
const tauriLibText = readFileSync(join(root, "src-tauri", "src", "lib.rs"), "utf8");
const cleanMachineSmokeText = readFileSync(join(root, "scripts", "clean-machine-smoke.ps1"), "utf8");
const releaseReadinessText = readFileSync(join(root, "scripts", "verify-release-readiness.ps1"), "utf8");
const installRustReleaseToolsText = readFileSync(join(root, "scripts", "install-rust-release-tools.ps1"), "utf8");
const signWindowsText = readFileSync(join(root, "scripts", "sign-windows.ps1"), "utf8");
const releaseScriptTestsText = readFileSync(join(root, "scripts", "test-release-scripts.ps1"), "utf8");
const releaseBundleVerifierText = readFileSync(join(root, "scripts", "verify-release-bundles.ps1"), "utf8");
const licenseText = existsSync(join(root, "LICENSE"))
  ? readFileSync(join(root, "LICENSE"), "utf8")
  : "";
const noticesText = existsSync(join(root, "THIRD_PARTY_NOTICES.md"))
  ? readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8")
  : "";
const requirements = readFileSync(join(root, "python-backend", "requirements.txt"), "utf8");
const requirementsLock = readFileSync(join(root, "python-backend", "requirements.lock.txt"), "utf8");
const packagingRequirementsLockPath = join(root, "python-backend", "packaging-requirements.lock.txt");
const packagingRequirementsLock = existsSync(packagingRequirementsLockPath)
  ? readFileSync(packagingRequirementsLockPath, "utf8")
  : "";
const releaseToolsRequirementsLockPath = join(root, "python-backend", "release-tools-requirements.lock.txt");
const releaseToolsRequirementsLock = existsSync(releaseToolsRequirementsLockPath)
  ? readFileSync(releaseToolsRequirementsLockPath, "utf8")
  : "";
const buildPythonSidecarText = readFileSync(join(root, "scripts", "build-python-sidecar.ps1"), "utf8");
const auditSecurityText = readFileSync(join(root, "scripts", "audit-security.ps1"), "utf8");
const generateSbomText = readFileSync(join(root, "scripts", "generate-sbom.ps1"), "utf8");

if (tauriConfig.includes("python-backend/venv") || tauriConfig.includes("python-backend\\\\venv")) {
  missing.push("tauri.conf.json must not bundle python-backend/venv");
}

const forbiddenTauriSurfacePatterns = [
  [/opener/i, "unused opener plugin/permission must not be present"],
  [/clipboard-manager/i, "clipboard-manager plugin must not be present"],
];

for (const [pattern, message] of forbiddenTauriSurfacePatterns) {
  for (const [label, text] of [
    ["src-tauri/capabilities/default.json", capabilityText],
    ["src-tauri/Cargo.toml", cargoManifestText],
    ["package.json", packageManifestText],
    ["package-lock.json", packageLockText],
  ]) {
    if (pattern.test(text)) {
      missing.push(`${label}: ${message}`);
    }
  }
}

const allowedCapabilityPermissions = new Set([
  "core:default",
  "core:window:allow-start-dragging",
  "core:window:allow-set-size",
  "core:window:allow-set-position",
  "core:window:allow-set-focus",
  "core:window:allow-show",
  "core:window:allow-hide",
  "core:window:allow-is-visible",
  "core:window:allow-outer-position",
  "core:window:allow-outer-size",
  "core:window:allow-current-monitor",
  "core:window:allow-scale-factor",
  "core:webview:allow-create-webview-window",
  "updater:default",
]);

for (const permission of parsedCapability.permissions ?? []) {
  if (!allowedCapabilityPermissions.has(permission)) {
    missing.push(`src-tauri/capabilities/default.json contains unexpected permission: ${permission}`);
  }
}

const bundledSourceDirs = [
  join(root, "python-backend", "models"),
  join(root, "python-backend-runtime"),
];
const forbiddenBundleEntries = new Set([
  ".cache",
  "__pycache__",
  "venv",
  "~orch",
  "~orchaudio",
]);

function scanForbiddenBundleEntries(path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) return;

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (forbiddenBundleEntries.has(entry.name)) {
      missing.push(`forbidden generated/runtime directory in bundled resources: ${child}`);
      continue;
    }
    if (entry.isDirectory()) {
      scanForbiddenBundleEntries(child);
    }
  }
}

for (const path of bundledSourceDirs) {
  scanForbiddenBundleEntries(path);
}

const checksumFile = join(modelsDir, "SHA256SUMS.txt");
if (existsSync(checksumFile)) {
  const checksumEntries = new Map();
  for (const rawLine of readFileSync(checksumFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line.trim()) continue;
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) {
      missing.push(`invalid checksum line in SHA256SUMS.txt: ${line}`);
      continue;
    }
    checksumEntries.set(match[2], match[1]);
  }

  for (const relativePath of requiredModelFiles) {
    const expectedHash = checksumEntries.get(relativePath);
    const absolutePath = join(modelsDir, relativePath);
    if (!expectedHash) {
      missing.push(`SHA256SUMS.txt is missing ${relativePath}`);
      continue;
    }
    if (existsSync(absolutePath)) {
      const actualHash = createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
      if (actualHash !== expectedHash) {
        missing.push(`SHA256 mismatch for ${relativePath}`);
      }
    }
  }

  for (const relativePath of checksumEntries.keys()) {
    if (!requiredModelFiles.includes(relativePath)) {
      missing.push(`SHA256SUMS.txt contains unexpected bundled asset: ${relativePath}`);
    }
  }
}

const requiredReleaseEvidenceFragments = [
  [
    "python-backend/app.py",
    backendAppText,
    [
      "Speech synthesis completed:",
      "voice=%s",
      "render_speech_with_deadline",
      "threading.Event()",
      "completed.wait(INFERENCE_DEADLINE_SECONDS)",
      "cancel_job(job_id)",
      "mark_backend_degraded",
      "backend_degraded()",
      "TTS service needs restart.",
      "inference_lock.release()",
    ],
  ],
  [
    "src/updateFlow.ts",
    updateFlowText,
    [
      "downloadAndInstall",
      "installStartupUpdate",
      "currentVersion",
    ],
  ],
  [
    "src/App.tsx",
    appFrontendText,
    [
      "installStartupUpdate(checkForUpdate",
      "Update installed. Restart SayIt.",
    ],
  ],
  [
    "src-tauri/src/lib.rs",
    tauriLibText,
    [
      "Backend ready:",
      "Backend restart succeeded:",
      "Backend health check failed:",
      "Backend health check failed repeatedly; restarting backend.",
      "consecutive_health_failures",
      "backend_healthcheck(&url, &token",
      "get_startup_status",
      "shortcut_startup_error",
      "DEFAULT_SHORTCUT_STARTUP_ERROR",
      "sayit-backend.log",
      "sayit-desktop.log",
    ],
  ],
  [
    "scripts/clean-machine-smoke.ps1",
    cleanMachineSmokeText,
    [
      "DesktopLogPath",
      "BackendLogPath",
      "diagnosticLogs",
      "desktopLogSha256",
      "backendLogSha256",
      "Kokoro TTS model loaded.",
      "voice=$voice",
      "Backend restart succeeded:",
    ],
  ],
  [
    "scripts/install-rust-release-tools.ps1",
    installRustReleaseToolsText,
    [
      'CargoAuditVersion = "0.22.2"',
      'CargoCyclonedxVersion = "0.5.9"',
      "cargo install cargo-audit --version $CargoAuditVersion --locked --force",
      "cargo install cargo-cyclonedx --version $CargoCyclonedxVersion --locked --force",
    ],
  ],
  [
    "scripts/verify-release-readiness.ps1",
    releaseReadinessText,
    [
      "diagnosticLogs",
      "desktopLogSha256",
      "backendLogSha256",
      "Clean-machine smoke backend diagnostic log is missing voice evidence",
      "Clean-machine smoke desktop diagnostic log hash no longer matches the report.",
      "Clean-machine smoke backend diagnostic log hash no longer matches the report.",
      "Test-ProductionTimestampUrl",
      "Signing timestamp URL must not point at a local, private, or reserved IP address.",
      "Test-UpdaterSigningPrivateKey",
      "must be a private updater signing key, not a public key.",
      "TAURI_SIGNING_PRIVATE_KEY_PATH",
      "[IO.Path]::IsPathRooted($ConfigPath)",
      "packagingRequirementsLockSha256",
      "releaseToolsRequirementsLockSha256",
      "python-packaging-audit.json",
      "python-release-tools-audit.json",
    ],
  ],
  [
    "scripts/build-python-sidecar.ps1",
    buildPythonSidecarText,
    [
      "packaging-requirements.lock.txt",
      "release-tools-requirements.lock.txt",
      "pip install --require-hashes -r $packagingRequirementsLock",
      "pip install --require-hashes -r $releaseToolsRequirementsLock",
    ],
  ],
  [
    "scripts/audit-security.ps1",
    auditSecurityText,
    [
      "python-packaging-audit.json",
      "python-release-tools-audit.json",
      "install-rust-release-tools.ps1",
      "packaging-requirements.lock.txt",
      "packagingRequirementsLockSha256",
      "release-tools-requirements.lock.txt",
      "releaseToolsRequirementsLockSha256",
    ],
  ],
  [
    "scripts/generate-sbom.ps1",
    generateSbomText,
    [
      "npx.cmd --no-install cyclonedx-npm",
      "install-rust-release-tools.ps1",
      "packaging-requirements.lock.txt",
      "packagingRequirementsLockSha256",
      "release-tools-requirements.lock.txt",
      "releaseToolsRequirementsLockSha256",
    ],
  ],
  [
    "scripts/sign-windows.ps1",
    signWindowsText,
    [
      "Assert-ProductionTimestampUrl",
      "SAYIT_SIGN_TIMESTAMP_URL must not point at a local, private, or reserved IP address.",
      "SAYIT_SIGN_CERT_PATH must point to a .pfx or .p12 certificate bundle.",
      "SAYIT_SIGN_CERT_THUMBPRINT must be a 40-character SHA-1 certificate thumbprint.",
    ],
  ],
  [
    "scripts/verify-release-bundles.ps1",
    releaseBundleVerifierText,
    [
      "[IO.Path]::IsPathRooted($BundleDir)",
      "Bundle directory does not exist:",
    ],
  ],
  [
    "scripts/test-release-scripts.ps1",
    releaseScriptTestsText,
    [
      "invalidTimestampUrls",
      "Expected signing timestamp URL to be rejected before signtool",
      "Expected invalid signing thumbprint to be rejected before signtool.",
      "Expected public updater key text to be rejected.",
      "Expected placeholder updater key text to be rejected.",
      "Expected public updater key file to be rejected.",
      "Expected readiness to load the absolute ConfigPath override.",
      "Expected release bundle verifier to preserve absolute BundleDir paths.",
    ],
  ],
  [
    "package.json",
    packageManifestText,
    [
      "test:release-scripts",
      "scripts/test-release-scripts.ps1",
    ],
  ],
  [
    ".github/workflows/ci.yml",
    ciWorkflowText,
    [
      "npm run test:release-scripts",
      "release-tools-requirements.lock.txt",
      "install-rust-release-tools.ps1",
    ],
  ],
  [
    ".github/workflows/release.yml",
    releaseWorkflowText,
    [
      "npm run test:release-scripts",
      "release-tools-requirements.lock.txt",
      "install-rust-release-tools.ps1",
    ],
  ],
];

for (const [label, text, fragments] of requiredReleaseEvidenceFragments) {
  for (const fragment of fragments) {
    if (!text.includes(fragment)) {
      missing.push(`${label} is missing release evidence guard: ${fragment}`);
    }
  }
}

if (parsedTauriConfig.bundle?.createUpdaterArtifacts !== true) {
  missing.push("tauri.conf.json must enable bundle.createUpdaterArtifacts");
}

if (!parsedTauriConfig.bundle?.windows?.signCommand) {
  missing.push("tauri.conf.json must configure bundle.windows.signCommand");
}

if (!parsedTauriConfig.plugins?.updater?.pubkey) {
  missing.push("tauri.conf.json must configure plugins.updater.pubkey");
}

if (!requirements.includes("https://download.pytorch.org/whl/cpu")) {
  missing.push("python-backend/requirements.txt must use the CPU PyTorch wheel index");
}

if (!/^torch==[^\r\n+]+\+cpu$/m.test(requirements)) {
  missing.push("python-backend/requirements.txt must pin a CPU-only torch build");
}

if (!requirementsLock.includes("--generate-hashes") || !requirementsLock.includes("--hash=sha256:")) {
  missing.push("python-backend/requirements.lock.txt must be generated with transitive hashes");
}

if (!packagingRequirementsLock) {
  missing.push("python-backend/packaging-requirements.lock.txt must exist");
} else {
  for (const packageName of [
    "pyinstaller",
    "pyinstaller-hooks-contrib",
    "altgraph",
    "pefile",
    "pywin32-ctypes",
    "setuptools",
  ]) {
    const pattern = new RegExp(`^${packageName}==`, "im");
    if (!pattern.test(packagingRequirementsLock)) {
      missing.push(`python-backend/packaging-requirements.lock.txt must pin ${packageName}`);
    }
  }

  if (!packagingRequirementsLock.includes("--hash=sha256:")) {
    missing.push("python-backend/packaging-requirements.lock.txt must use hashes");
  }
}

if (!releaseToolsRequirementsLock) {
  missing.push("python-backend/release-tools-requirements.lock.txt must exist");
} else {
  for (const packageName of [
    "pip",
    "pip-audit",
    "cyclonedx-bom",
    "cyclonedx-python-lib",
    "cachecontrol",
    "requests",
  ]) {
    const pattern = new RegExp(`^${packageName}==`, "im");
    if (!pattern.test(releaseToolsRequirementsLock)) {
      missing.push(`python-backend/release-tools-requirements.lock.txt must pin ${packageName}`);
    }
  }

  if (!releaseToolsRequirementsLock.includes("--hash=sha256:")) {
    missing.push("python-backend/release-tools-requirements.lock.txt must use hashes");
  }
}

for (const [label, text] of [
  ["scripts/build-python-sidecar.ps1", buildPythonSidecarText],
  ["scripts/audit-security.ps1", auditSecurityText],
  ["scripts/generate-sbom.ps1", generateSbomText],
  [".github/workflows/ci.yml", ciWorkflowText],
  [".github/workflows/release.yml", releaseWorkflowText],
]) {
  if (/pip\s+install\s+--upgrade/i.test(text)) {
    missing.push(`${label} must not upgrade pip or release Python tools without hashes`);
  }
  if (/pip\s+install\s+(?!.*--require-hashes)/i.test(text)) {
    missing.push(`${label} must use --require-hashes for pip installs`);
  }
}

if (!packageManifestText.includes('"@cyclonedx/cyclonedx-npm": "6.0.0"')) {
  missing.push("package.json must pin @cyclonedx/cyclonedx-npm for locked npm SBOM generation");
}

if (!packageLockText.includes('"node_modules/@cyclonedx/cyclonedx-npm"')) {
  missing.push("package-lock.json must lock @cyclonedx/cyclonedx-npm");
}

for (const [label, text] of [
  ["scripts/install-rust-release-tools.ps1", installRustReleaseToolsText],
  ["scripts/audit-security.ps1", auditSecurityText],
  ["scripts/generate-sbom.ps1", generateSbomText],
  [".github/workflows/ci.yml", ciWorkflowText],
  [".github/workflows/release.yml", releaseWorkflowText],
]) {
  const cargoInstallLines = text.match(/^.*cargo\s+install\s+.*$/gim) ?? [];
  for (const line of cargoInstallLines) {
    if (!/--version\s+\S+/i.test(line) || !/--locked/i.test(line)) {
      missing.push(`${label} must pin cargo-installed release tools with --version and --locked`);
      break;
    }
  }
}

if (/npx\.cmd\s+--yes/i.test(generateSbomText) || !generateSbomText.includes("npx.cmd --no-install cyclonedx-npm")) {
  missing.push("scripts/generate-sbom.ps1 must use locked npm CycloneDX tooling with npx --no-install");
}

if (!/MIT License/i.test(licenseText)) {
  missing.push("LICENSE must contain the application license text");
}

if (!/Kokoro/i.test(noticesText) || !/SBOM/i.test(noticesText)) {
  missing.push("THIRD_PARTY_NOTICES.md must reference bundled Kokoro assets and generated SBOMs");
}

if (missing.length > 0) {
  console.error("Release assets are incomplete. Run: powershell -ExecutionPolicy Bypass -File scripts/build-python-sidecar.ps1");
  for (const path of missing) {
    console.error(`missing: ${path}`);
  }
  exit(1);
}
