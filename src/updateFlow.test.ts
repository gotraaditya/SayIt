import { describe, expect, it, vi } from "vitest";
import { installStartupUpdate, type UpdateStatus } from "./updateFlow";

describe("startup update flow", () => {
  it("does nothing when no update is available", async () => {
    const statuses: UpdateStatus[] = [];
    const relaunchApp = vi.fn().mockResolvedValue(undefined);
    const installed = await installStartupUpdate(
      vi.fn().mockResolvedValue(null),
      (status) => statuses.push(status),
      5000,
      relaunchApp,
    );

    expect(installed).toBe(false);
    expect(relaunchApp).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
  });

  it("downloads, installs, and relaunches an available update", async () => {
    const statuses: UpdateStatus[] = [];
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const relaunchApp = vi.fn().mockResolvedValue(undefined);
    const installed = await installStartupUpdate(
      vi.fn().mockResolvedValue({
        currentVersion: "0.1.0",
        version: "0.1.1",
        downloadAndInstall,
      }),
      (status) => statuses.push(status),
      5000,
      relaunchApp,
    );

    expect(installed).toBe(true);
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunchApp).toHaveBeenCalledOnce();
    expect(statuses).toEqual([
      { state: "available", currentVersion: "0.1.0", version: "0.1.1" },
      { state: "installed", version: "0.1.1" },
    ]);
  });
});
