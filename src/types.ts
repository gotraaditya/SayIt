export type AppStatus =
  | "ready"
  | "loading"
  | "reading"
  | "updating"
  | "saved"
  | "error";
export type SurfaceMode = "glass" | "solid";

export type SettingsUpdate = {
  shortcut?: string;
  voice?: string;
  volume?: number;
  playbackSpeed?: number;
  surfaceMode?: SurfaceMode;
};

export type SayItWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    stopReading?: () => void;
  };

export type Captions = {
  current: string;
  next: string;
};
