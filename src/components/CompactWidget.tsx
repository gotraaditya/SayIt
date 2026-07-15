import { formatPlaybackSpeed } from "../formatting";
import type { AppStatus, Captions } from "../types";

type CompactWidgetProps = {
  status: AppStatus;
  statusLabel: string;
  statusMessage: string;
  isActive: boolean;
  captions: Captions;
  outgoingCaption: string;
  captionIndex: number;
  errorCause: string;
  lastCapturedText: string;
  hasSeenIntro: boolean;
  playbackSpeed: number;
  onRetry: () => void;
  onCyclePlaybackSpeed: () => void;
  onToggleSettings: () => void;
  onDismiss: () => void;
};

export function CompactWidget({
  status,
  statusLabel,
  statusMessage,
  isActive,
  captions,
  outgoingCaption,
  captionIndex,
  errorCause,
  lastCapturedText,
  hasSeenIntro,
  playbackSpeed,
  onRetry,
  onCyclePlaybackSpeed,
  onToggleSettings,
  onDismiss,
}: CompactWidgetProps) {
  return (
    <section className="compact-widget">
      <div className="caption-stage">
        <div className="compact-heading">
          <div className="brand" aria-label="SayIt">
            <span className={`status-dot status-${status}`} aria-hidden="true" />
            <h1>SayIt</h1>
          </div>
          <div className="status-copy" role="status" aria-live="polite">
            <strong>{statusLabel}</strong>
            {isActive && <span>{statusMessage}</span>}
          </div>
        </div>
        {isActive && captions.current ? (
          <div
            className="caption-stack"
            aria-live="off"
            aria-label="Text currently being spoken"
          >
            {outgoingCaption && (
              <p key={`outgoing-${captionIndex}`} className="outgoing-caption">
                {outgoingCaption}
              </p>
            )}
            <p key={`current-${captionIndex}`} className="current-caption">
              {captions.current}
            </p>
            {captions.next && (
              <p key={`next-${captionIndex}`} className="next-caption">
                {captions.next}
              </p>
            )}
          </div>
        ) : (
          <div className={`idle-caption ${status === "error" ? "is-error" : ""}`}>
            <span>
              {status === "error" ? errorCause || statusMessage : statusMessage}
            </span>
            {status === "error" ? (
              <button
                type="button"
                className="retry-button"
                onClick={onRetry}
                disabled={!lastCapturedText.trim()}
              >
                Retry
              </button>
            ) : (
              <small>
                {hasSeenIntro
                  ? "SayIt appears here while it reads."
                  : "Tip: SayIt keeps running in the tray after hiding."}
              </small>
            )}
          </div>
        )}
      </div>
      <aside className="action-rail" aria-label="Widget controls">
        {isActive && (
          <button
            type="button"
            className="icon-button rail-button speed-button"
            onClick={onCyclePlaybackSpeed}
            aria-label={`Reading speed ${playbackSpeed} times. Click to change.`}
            title="Change reading speed"
          >
            {formatPlaybackSpeed(playbackSpeed)}
          </button>
        )}
        <button
          type="button"
          className="icon-button rail-button settings-button"
          onClick={onToggleSettings}
          aria-label="Open settings"
          title="Settings"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.95 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.58 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.95a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.62.7 1.05 1.34 1.05H21v4h-.26c-.63 0-1.2.43-1.34 1Z" />
          </svg>
        </button>
        {isActive ? (
          <button
            type="button"
            className="icon-button rail-button stop-button"
            onClick={onDismiss}
            aria-label="Stop reading and hide SayIt"
            title="Stop and hide"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="icon-button rail-button close-button"
            onClick={onDismiss}
            aria-label="Hide SayIt"
            title="Hide SayIt"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </aside>
    </section>
  );
}
