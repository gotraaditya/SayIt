import { invoke } from "@tauri-apps/api/core";
import {
  BACKEND_RETRY_DELAY_MS,
  BACKEND_STARTUP_ATTEMPTS,
} from "./appConstants";

type BackendConfig = {
  url: string;
  token: string;
};

export class SayItBackendClient {
  private backendConfig: BackendConfig | null = null;
  private activeJobId: string | null = null;

  resetConfig() {
    this.backendConfig = null;
  }

  private async getConfig() {
    if (this.backendConfig) return this.backendConfig;
    const backendConfig = await invoke<BackendConfig>("get_backend_config");
    this.backendConfig = backendConfig;
    return backendConfig;
  }

  private async cancelJob(jobId: string) {
    try {
      const backendConfig = await this.getConfig();
      await fetch(`${backendConfig.url}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SayIt-Token": backendConfig.token,
        },
        body: JSON.stringify({ job_id: jobId }),
      });
    } catch (error) {
      console.error("Unable to cancel backend job", error);
    }
  }

  async requestSpeechAudio(
    text: string,
    selectedVoice: string,
    signal?: AbortSignal,
  ) {
    const jobId = crypto.randomUUID();
    this.activeJobId = jobId;
    const abortHandler = () => {
      void this.cancelJob(jobId);
    };
    signal?.addEventListener("abort", abortHandler, { once: true });
    let lastConnectionError: unknown = null;

    try {
      for (let attempt = 0; attempt < BACKEND_STARTUP_ATTEMPTS; attempt += 1) {
        let response: Response;
        try {
          const backendConfig = await this.getConfig();
          response = await fetch(`${backendConfig.url}/synthesize`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-SayIt-Token": backendConfig.token,
            },
            body: JSON.stringify({ text, voice: selectedVoice, job_id: jobId }),
            signal,
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          lastConnectionError = error;
          this.resetConfig();
          if (attempt + 1 === BACKEND_STARTUP_ATTEMPTS) break;
          await new Promise((resolve) =>
            window.setTimeout(resolve, BACKEND_RETRY_DELAY_MS),
          );
          continue;
        }

        if (!response.ok) {
          let detail = `Speech service error (${response.status})`;
          try {
            const payload = await response.json();
            if (typeof payload.detail === "string") {
              detail = payload.detail.split("\n", 1)[0];
            }
          } catch {
            // Keep the concise status-based fallback.
          }
          throw new Error(detail);
        }

        return response.blob();
      }

      throw new Error(
        `Speech service did not start${
          lastConnectionError instanceof Error
            ? `: ${lastConnectionError.message}`
            : ""
        }`,
      );
    } finally {
      signal?.removeEventListener("abort", abortHandler);
      if (this.activeJobId === jobId) {
        this.activeJobId = null;
      }
    }
  }
}
