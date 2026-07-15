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
