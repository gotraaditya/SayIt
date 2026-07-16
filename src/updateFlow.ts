type UpdateCheckOptions = {
  timeout: number;
};

type UpdateCandidate = {
  currentVersion: string;
  version: string;
  downloadAndInstall: () => Promise<void>;
};

export type UpdateStatus =
  | { state: "available"; currentVersion: string; version: string }
  | { state: "installed"; version: string };

export type UpdateCheck = (
  options: UpdateCheckOptions,
) => Promise<UpdateCandidate | null>;

export async function installStartupUpdate(
  checkForUpdate: UpdateCheck,
  onStatus: (status: UpdateStatus) => void,
  timeout = 5000,
  relaunchApp: () => Promise<void> = async () => {},
) {
  const update = await checkForUpdate({ timeout });
  if (!update) return false;

  onStatus({
    state: "available",
    currentVersion: update.currentVersion,
    version: update.version,
  });
  await update.downloadAndInstall();
  onStatus({ state: "installed", version: update.version });
  await relaunchApp();
  return true;
}
