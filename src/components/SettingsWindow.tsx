import type { CSSProperties, KeyboardEvent } from "react";
import { VOICE_GROUPS } from "../appConstants";
import { formatShortcut } from "../shortcut";
import type { AppStatus, SurfaceMode } from "../types";

type SettingsWindowProps = {
  status: AppStatus;
  shortcutInput: string;
  isRecordingShortcut: boolean;
  settingsFeedback: string;
  isPreviewing: boolean;
  voice: string;
  volume: number;
  surfaceMode: SurfaceMode;
  onCloseSettings: () => void;
  onDismiss: () => void;
  onStartShortcutRecording: () => void;
  onShortcutKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onPreviewVoice: () => void;
  onVoiceChange: (voice: string) => void;
  onVolumeChange: (volume: number) => void;
  onToggleSurfaceMode: () => void;
  onSaveShortcut: () => void;
};

export function SettingsWindow({
  status,
  shortcutInput,
  isRecordingShortcut,
  settingsFeedback,
  isPreviewing,
  voice,
  volume,
  surfaceMode,
  onCloseSettings,
  onDismiss,
  onStartShortcutRecording,
  onShortcutKeyDown,
  onPreviewVoice,
  onVoiceChange,
  onVolumeChange,
  onToggleSurfaceMode,
  onSaveShortcut,
}: SettingsWindowProps) {
  const rangeStyle = {
    "--range-progress": `${((volume - 0.5) / 3.5) * 100}%`,
  } as CSSProperties;

  return (
    <>
      <header className="titlebar">
        <div className="brand" aria-label="SayIt">
          <span className={`status-dot status-${status}`} aria-hidden="true" />
          <h1>SayIt</h1>
        </div>
        <span className="view-title">Settings</span>
        <div className="window-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onCloseSettings}
            aria-label="Close settings"
            title="Close settings"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onDismiss}
            aria-label="Hide SayIt"
            title="Hide SayIt"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      <section className="settings-panel" aria-label="SayIt settings">
        <div className="field-group">
          <div className="field-heading">
            <label id="shortcut-label">Keyboard shortcut</label>
            <span>Works from any app</span>
          </div>
          <button
            type="button"
            className={`shortcut-recorder ${isRecordingShortcut ? "is-recording" : ""}`}
            onClick={onStartShortcutRecording}
            onKeyDown={onShortcutKeyDown}
            aria-labelledby="shortcut-label"
            aria-pressed={isRecordingShortcut}
          >
            <span>
              {isRecordingShortcut
                ? "Press shortcut..."
                : formatShortcut(shortcutInput)}
            </span>
            <kbd>{isRecordingShortcut ? "Listening" : "Change"}</kbd>
          </button>
        </div>

        <div className="field-group">
          <div className="field-heading inline-heading">
            <label htmlFor="voice">Voice</label>
            <button
              type="button"
              className="text-button"
              onClick={onPreviewVoice}
              disabled={isPreviewing}
            >
              {isPreviewing ? "Playing..." : "Preview"}
            </button>
          </div>
          <div className="select-wrapper">
            <select
              id="voice"
              value={voice}
              onChange={(event) => onVoiceChange(event.target.value)}
            >
              {VOICE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.voices.map((voiceOption) => (
                    <option key={voiceOption.value} value={voiceOption.value}>
                      {voiceOption.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7 10 5 5 5-5" />
            </svg>
          </div>
        </div>

        <div className="field-group">
          <div className="field-heading inline-heading">
            <label htmlFor="volume">Output volume</label>
            <output htmlFor="volume">{Math.round(volume * 100)}%</output>
          </div>
          <input
            id="volume"
            type="range"
            min="0.5"
            max="4"
            step="0.1"
            value={volume}
            onChange={(event) => onVolumeChange(parseFloat(event.target.value))}
            style={rangeStyle}
          />
        </div>

        <div className="field-group compact-field">
          <div className="field-heading inline-heading">
            <label id="surface-label">Readable surface</label>
            <button
              type="button"
              className={`toggle-pill ${surfaceMode === "solid" ? "is-on" : ""}`}
              onClick={onToggleSurfaceMode}
              aria-labelledby="surface-label"
              aria-pressed={surfaceMode === "solid"}
            >
              {surfaceMode === "solid" ? "On" : "Off"}
            </button>
          </div>
        </div>

        <p className="settings-feedback" aria-live="polite">
          {settingsFeedback ||
            "Voice and volume changes are saved automatically."}
        </p>

        <button type="button" className="primary-button" onClick={onSaveShortcut}>
          Save settings
        </button>
      </section>
    </>
  );
}
