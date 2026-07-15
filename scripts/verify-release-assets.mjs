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
const backendAppText = readFileSync(join(root, "python-backend", "app.py"), "utf8");
const tauriLibText = readFileSync(join(root, "src-tauri", "src", "lib.rs"), "utf8");
const cleanMachineSmokeText = readFileSync(join(root, "scripts", "clean-machine-smoke.ps1"), "utf8");
const releaseReadinessText = readFileSync(join(root, "scripts", "verify-release-readiness.ps1"), "utf8");
const licenseText = existsSync(join(root, "LICENSE"))
  ? readFileSync(join(root, "LICENSE"), "utf8")
  : "";
const noticesText = existsSync(join(root, "THIRD_PARTY_NOTICES.md"))
  ? readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8")
  : "";
const requirements = readFileSync(join(root, "python-backend", "requirements.txt"), "utf8");
const requirementsLock = readFileSync(join(root, "python-backend", "requirements.lock.txt"), "utf8");

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
    ],
  ],
  [
    "src-tauri/src/lib.rs",
    tauriLibText,
    [
      "Backend ready:",
      "Backend restart succeeded:",
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
    "scripts/verify-release-readiness.ps1",
    releaseReadinessText,
    [
      "diagnosticLogs",
      "desktopLogSha256",
      "backendLogSha256",
      "Clean-machine smoke backend diagnostic log is missing voice evidence",
      "Clean-machine smoke desktop diagnostic log hash no longer matches the report.",
      "Clean-machine smoke backend diagnostic log hash no longer matches the report.",
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
