import { LogicalSize } from "@tauri-apps/api/dpi";

export const COMPACT_SIZE = new LogicalSize(328, 112);
export const ACTIVE_SIZE = new LogicalSize(328, 140);
export const CAPTION_LINE_WIDTH = 220;
export const BACKEND_STARTUP_ATTEMPTS = 60;
export const BACKEND_RETRY_DELAY_MS = 500;
export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 2, 3] as const;
export const WINDOW_EDGE_MARGIN = 12;
export const SETTINGS_WINDOW = { width: 336, height: 456 } as const;

export const VOICE_GROUPS = [
  {
    label: "Female voices",
    voices: [
      { value: "af_heart", label: "Heart" },
      { value: "af_bella", label: "Bella" },
      { value: "af_nicole", label: "Nicole" },
      { value: "af_sky", label: "Sky" },
      { value: "af_alloy", label: "Alloy" },
      { value: "af_jessica", label: "Jessica" },
    ],
  },
  {
    label: "Male voices",
    voices: [
      { value: "am_adam", label: "Adam" },
      { value: "am_michael", label: "Michael" },
      { value: "am_onyx", label: "Onyx" },
      { value: "am_echo", label: "Echo" },
      { value: "am_fenrir", label: "Fenrir" },
    ],
  },
] as const;
