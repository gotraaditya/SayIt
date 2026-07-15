import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import "./App.css";
import {
  ACTIVE_SIZE,
  BACKEND_RETRY_DELAY_MS,
  BACKEND_STARTUP_ATTEMPTS,
  COMPACT_SIZE,
  PLAYBACK_SPEEDS,
  SETTINGS_WINDOW,
  WINDOW_EDGE_MARGIN,
} from "./appConstants";
import { splitIntoCaptionLines } from "./captions";
import { CompactWidget } from "./components/CompactWidget";
import { SettingsWindow } from "./components/SettingsWindow";
import { formatShortcut, validateShortcut } from "./shortcut";
import {
  buildCaptionGroups,
  MAX_SELECTED_TEXT_CHARS,
  splitTextForSynthesis,
} from "./textProcessing";
import type { AppStatus, SayItWindow, SettingsUpdate, SurfaceMode } from "./types";

type BackendConfig = {
  url: string;
  token: string;
};

const markIntroSeen = () => localStorage.setItem("hasSeenIntro", "true");

const getErrorMessage = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Reading cancelled";
  }

  if (error instanceof Error) {
    if (error.message.includes("did not start")) {
      return "Speech service didn’t respond";
    }
    if (error.message.includes("playback")) {
      return "Audio playback failed";
    }
    return error.message || "Couldn’t play the selection";
  }

  return "Couldn’t play the selection";
};

function App() {
  const storedShortcut = localStorage.getItem("shortcut") || "alt+s";
  const [status, setStatus] = useState<AppStatus>("ready");
  const [statusMessage, setStatusMessage] = useState(
    `Select text · ${formatShortcut(storedShortcut)}`,
  );
  const [shortcutInput, setShortcutInput] = useState(storedShortcut);
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [hasSeenIntro, setHasSeenIntro] = useState(
    localStorage.getItem("hasSeenIntro") === "true",
  );
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>(
    () => (localStorage.getItem("surfaceMode") === "solid" ? "solid" : "glass"),
  );
  const [playbackSpeed, setPlaybackSpeed] = useState(() => {
    const savedSpeed = parseFloat(localStorage.getItem("playbackSpeed") || "1");
    return PLAYBACK_SPEEDS.some((speed) => speed === savedSpeed) ? savedSpeed : 1;
  });
  const [captionIndex, setCaptionIndex] = useState(0);
  const [captions, setCaptions] = useState({ current: "", next: "" });
  const [outgoingCaption, setOutgoingCaption] = useState("");
  const [lastCapturedText, setLastCapturedText] = useState("");
  const [errorCause, setErrorCause] = useState("");

  // Kokoro output is quiet, so SayIt intentionally supports gain above 100%.
  const [volume, setVolume] = useState(() =>
    parseFloat(localStorage.getItem("volume") || "2.0"),
  );
  const [voice, setVoice] = useState(
    localStorage.getItem("voice") || "af_heart",
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const voiceRef = useRef(voice);
  const playbackSpeedRef = useRef(playbackSpeed);
  const shortcutRef = useRef(storedShortcut);
  const backendConfigRef = useRef<BackendConfig | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const captionTransitionTimeoutRef = useRef<number | null>(null);
  const playbackRunIdRef = useRef(0);
  const settingsOpenedDuringPlaybackRef = useRef(false);
  const isActiveRef = useRef(false);
  const statusRef = useRef<AppStatus>("ready");
  const windowLabel = getCurrentWindow().label;
  const isSettingsWindow = windowLabel === "settings";

  const isActive = status === "loading" || status === "reading";

  const resizeWindow = async (size: LogicalSize) => {
    try {
      await getCurrentWindow().setSize(size);
    } catch (error) {
      console.error("Unable to resize SayIt", error);
    }
  };

  const hideWidget = async () => {
    try {
      await invoke("hide_window");
    } catch (commandError) {
      try {
        await getCurrentWindow().hide();
      } catch (windowError) {
        console.error("Unable to hide SayIt", commandError, windowError);
      }
    }
  };

  const getSettingsWindowPosition = async () => {
    const mainWindow = getCurrentWindow();
    const monitor = await currentMonitor();
    const mainPosition = await mainWindow.outerPosition();
    const mainSize = await mainWindow.outerSize();
    const scaleFactor = monitor?.scaleFactor || (await mainWindow.scaleFactor());
    const mainLogicalPosition = mainPosition.toLogical(scaleFactor);
    const mainLogicalSize = mainSize.toLogical(scaleFactor);

    if (!monitor) {
      return {
        x: Math.round(mainLogicalPosition.x),
        y: Math.round(mainLogicalPosition.y + mainLogicalSize.height + 10),
      };
    }

    const workAreaPosition = monitor.workArea.position.toLogical(scaleFactor);
    const workAreaSize = monitor.workArea.size.toLogical(scaleFactor);
    const minX = workAreaPosition.x + WINDOW_EDGE_MARGIN;
    const minY = workAreaPosition.y + WINDOW_EDGE_MARGIN;
    const maxX =
      workAreaPosition.x +
      workAreaSize.width -
      SETTINGS_WINDOW.width -
      WINDOW_EDGE_MARGIN;
    const maxY =
      workAreaPosition.y +
      workAreaSize.height -
      SETTINGS_WINDOW.height -
      WINDOW_EDGE_MARGIN;
    const preferredX = mainLogicalPosition.x;
    const preferredY =
      mainLogicalPosition.y + mainLogicalSize.height + 10 + SETTINGS_WINDOW.height <= maxY
        ? mainLogicalPosition.y + mainLogicalSize.height + 10
        : mainLogicalPosition.y - SETTINGS_WINDOW.height - 10;

    return {
      x: Math.round(Math.min(Math.max(preferredX, minX), Math.max(minX, maxX))),
      y: Math.round(Math.min(Math.max(preferredY, minY), Math.max(minY, maxY))),
    };
  };

  const openSettingsWindow = async () => {
    try {
      const existingSettingsWindow = await WebviewWindow.getByLabel("settings");
      if (existingSettingsWindow) {
        const isSettingsVisible = await existingSettingsWindow.isVisible();
        if (isSettingsVisible) {
          await emit("settings_closed");
          await existingSettingsWindow.hide();
          return;
        }

        const position = await getSettingsWindowPosition();
        await existingSettingsWindow.setSize(
          new LogicalSize(SETTINGS_WINDOW.width, SETTINGS_WINDOW.height),
        );
        await existingSettingsWindow.setPosition(
          new LogicalPosition(position.x, position.y),
        );
        await existingSettingsWindow.show();
        await existingSettingsWindow.setFocus();
        return;
      }

      const position = await getSettingsWindowPosition();
      const settingsWindow = new WebviewWindow("settings", {
        url: "/?window=settings",
        title: "SayIt Settings",
        width: SETTINGS_WINDOW.width,
        height: SETTINGS_WINDOW.height,
        x: position.x,
        y: position.y,
        resizable: false,
        fullscreen: false,
        transparent: true,
        decorations: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        visible: true,
        focus: true,
        preventOverflow: {
          width: WINDOW_EDGE_MARGIN,
          height: WINDOW_EDGE_MARGIN,
        },
      });

      settingsWindow.once("tauri://error", (event) => {
        console.error("Unable to open SayIt settings", event.payload);
      });
    } catch (error) {
      console.error("Unable to open SayIt settings", error);
    }
  };

  const getBackendConfig = async () => {
    if (backendConfigRef.current) return backendConfigRef.current;
    const backendConfig = await invoke<BackendConfig>("get_backend_config");
    backendConfigRef.current = backendConfig;
    return backendConfig;
  };

  const cancelBackendJob = async (jobId: string) => {
    try {
      const backendConfig = await getBackendConfig();
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
  };

  const requestSpeechAudio = async (
    text: string,
    selectedVoice: string,
    signal?: AbortSignal,
  ) => {
    const jobId = crypto.randomUUID();
    activeJobIdRef.current = jobId;
    const abortHandler = () => {
      void cancelBackendJob(jobId);
    };
    signal?.addEventListener("abort", abortHandler, { once: true });
    let lastConnectionError: unknown = null;

    try {
      for (let attempt = 0; attempt < BACKEND_STARTUP_ATTEMPTS; attempt += 1) {
        let response: Response;
        try {
          const backendConfig = await getBackendConfig();
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
          backendConfigRef.current = null;
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
      if (activeJobIdRef.current === jobId) {
        activeJobIdRef.current = null;
      }
    }
  };

  const resetToReady = () => {
    if (captionTransitionTimeoutRef.current !== null) {
      window.clearTimeout(captionTransitionTimeoutRef.current);
      captionTransitionTimeoutRef.current = null;
    }
    setStatus("ready");
    setStatusMessage(`Select text · ${formatShortcut(shortcutRef.current)}`);
    setCaptions({ current: "", next: "" });
    setOutgoingCaption("");
    setCaptionIndex(0);
    setErrorCause("");
  };

  useEffect(() => {
    const backendRestarted = listen("backend_restarted", () => {
      backendConfigRef.current = null;
      if (statusRef.current === "error") {
        resetToReady();
      }
    });
    const backendStatus = listen<string>("backend_status", (event) => {
      backendConfigRef.current = null;
      setStatus("error");
      setStatusMessage("Speech service unavailable");
      setErrorCause(event.payload);
    });
    const shortcutError = listen<string>("shortcut_error", (event) => {
      setStatus("error");
      setStatusMessage("Shortcut unavailable");
      setErrorCause(event.payload);
    });

    return () => {
      backendRestarted.then((dispose) => dispose());
      backendStatus.then((dispose) => dispose());
      shortcutError.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (isSettingsWindow) return;

    let disposed = false;
    checkForUpdate({ timeout: 5000 })
      .then((update) => {
        if (disposed || !update) return;
        console.info(
          `SayIt update available: ${update.currentVersion} -> ${update.version}`,
        );
      })
      .catch((error) => {
        console.info("SayIt update check skipped or failed", error);
      });

    return () => {
      disposed = true;
    };
  }, [isSettingsWindow]);

  useEffect(() => {
    const saved = localStorage.getItem("shortcut");
    if (saved && saved !== "alt+s") {
      invoke("update_shortcut", { newShortcut: saved }).catch((error) => {
        console.error("Failed to sync shortcut", error);
        setStatus("error");
        setStatusMessage("Shortcut unavailable");
        setErrorCause("Saved shortcut is no longer available. Open settings to choose another.");
      });
    }

    if (audioRef.current && !gainNodeRef.current) {
      try {
        const browserWindow = window as SayItWindow;
        const AudioContextClass =
          browserWindow.AudioContext || browserWindow.webkitAudioContext;
        const audioContext = new AudioContextClass();
        const gainNode = audioContext.createGain();
        gainNode.gain.value = volume;
        gainNodeRef.current = gainNode;

        const source = audioContext.createMediaElementSource(audioRef.current);
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        audioRef.current.preservesPitch = true;
        audioRef.current.playbackRate = playbackSpeed;
      } catch (error) {
        console.error("Audio API initialization failed", error);
      }
    }
  }, []);

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = volume;
    localStorage.setItem("volume", volume.toString());
    emit("settings_updated", { volume }).catch((error) =>
      console.error("Unable to sync volume", error),
    );
  }, [volume]);

  useEffect(() => {
    voiceRef.current = voice;
    localStorage.setItem("voice", voice);
    emit("settings_updated", { voice }).catch((error) =>
      console.error("Unable to sync voice", error),
    );
  }, [voice]);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
    localStorage.setItem("playbackSpeed", playbackSpeed.toString());
    if (audioRef.current) {
      audioRef.current.preservesPitch = true;
      audioRef.current.playbackRate = playbackSpeed;
    }
    emit("settings_updated", { playbackSpeed }).catch((error) =>
      console.error("Unable to sync playback speed", error),
    );
  }, [playbackSpeed]);

  useEffect(() => {
    localStorage.setItem("surfaceMode", surfaceMode);
    emit("settings_updated", { surfaceMode }).catch((error) =>
      console.error("Unable to sync surface mode", error),
    );
  }, [surfaceMode]);

  useEffect(() => {
    shortcutRef.current = shortcutInput;
  }, [shortcutInput]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    const unlisten = listen<SettingsUpdate>("settings_updated", (event) => {
      const nextSettings = event.payload;
      if (typeof nextSettings.shortcut === "string") {
        setShortcutInput((currentShortcut) =>
          currentShortcut === nextSettings.shortcut
            ? currentShortcut
            : nextSettings.shortcut!,
        );
        shortcutRef.current = nextSettings.shortcut;
        if (statusRef.current === "ready") {
          setStatusMessage(`Select text · ${formatShortcut(nextSettings.shortcut)}`);
        }
      }
      if (typeof nextSettings.voice === "string") {
        setVoice((currentVoice) =>
          currentVoice === nextSettings.voice ? currentVoice : nextSettings.voice!,
        );
      }
      if (typeof nextSettings.volume === "number") {
        setVolume((currentVolume) =>
          currentVolume === nextSettings.volume ? currentVolume : nextSettings.volume!,
        );
      }
      if (typeof nextSettings.playbackSpeed === "number") {
        setPlaybackSpeed((currentSpeed) =>
          currentSpeed === nextSettings.playbackSpeed
            ? currentSpeed
            : nextSettings.playbackSpeed!,
        );
      }
      if (
        nextSettings.surfaceMode === "glass" ||
        nextSettings.surfaceMode === "solid"
      ) {
        setSurfaceMode((currentMode) =>
          currentMode === nextSettings.surfaceMode
            ? currentMode
            : nextSettings.surfaceMode!,
        );
      }
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (isSettingsWindow) return;

    const unlisten = listen("settings_closed", async () => {
      if (!settingsOpenedDuringPlaybackRef.current) return;
      settingsOpenedDuringPlaybackRef.current = false;
      if (!isActiveRef.current) {
        await resizeWindow(COMPACT_SIZE);
        await hideWidget();
      }
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (isSettingsWindow) return;

    const unlisten = listen("open_settings_request", async () => {
      setHasSeenIntro(true);
      markIntroSeen();
      await openSettingsWindow();
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(
    () => () => {
      if (captionTransitionTimeoutRef.current !== null) {
        window.clearTimeout(captionTransitionTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (isSettingsWindow) return;

    const unlisten = listen<string>("text_captured", async (event) => {
      const browserWindow = window as SayItWindow;
      browserWindow.stopReading?.();
      activeAbortControllerRef.current?.abort();
      playbackRunIdRef.current += 1;
      const playbackRunId = playbackRunIdRef.current;
      const isCurrentPlaybackRun = () => playbackRunIdRef.current === playbackRunId;

      if (captionTransitionTimeoutRef.current !== null) {
        window.clearTimeout(captionTransitionTimeoutRef.current);
        captionTransitionTimeoutRef.current = null;
      }

      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;
      const capturedText = event.payload.trim();
      setLastCapturedText(event.payload);
      setHasSeenIntro(true);
      markIntroSeen();
      setStatus("loading");
      setCaptions({ current: "", next: "" });
      setOutgoingCaption("");
      setCaptionIndex(0);
      setStatusMessage("Preparing audio…");
      settingsOpenedDuringPlaybackRef.current = false;

      if (!capturedText || capturedText === "No text selected.") {
        setStatus("error");
        setStatusMessage("No selected text to read");
        setErrorCause("No selected text to read");
        setLastCapturedText("");
        setCaptions({ current: "", next: "" });
        setOutgoingCaption("");
        await resizeWindow(COMPACT_SIZE);
        return;
      }

      if (
        capturedText === "Failed to read selected text." ||
        capturedText === "Selection capture is unavailable."
      ) {
        setStatus("error");
        setStatusMessage("Selection capture failed");
        setErrorCause("Selection capture failed");
        setLastCapturedText("");
        setCaptions({ current: "", next: "" });
        setOutgoingCaption("");
        await resizeWindow(COMPACT_SIZE);
        return;
      }

      if (capturedText.length > MAX_SELECTED_TEXT_CHARS) {
        setStatus("error");
        setStatusMessage("Selection is too long");
        setErrorCause(
          `Select up to ${MAX_SELECTED_TEXT_CHARS.toLocaleString()} characters.`,
        );
        setLastCapturedText("");
        setCaptions({ current: "", next: "" });
        setOutgoingCaption("");
        await resizeWindow(COMPACT_SIZE);
        return;
      }

      const textChunks = splitTextForSynthesis(capturedText);
      const captionGroups = buildCaptionGroups(textChunks, splitIntoCaptionLines);
      const allCaptionLines = captionGroups.flatMap((group) => group.lines);
      let visibleLineIndex = -1;

      const showCaptionLine = (lineIndex: number) => {
        if (!isCurrentPlaybackRun()) return;
        const nextIndex = Math.min(
          Math.max(0, lineIndex),
          allCaptionLines.length - 1,
        );
        if (nextIndex === visibleLineIndex) return;

        if (visibleLineIndex >= 0) {
          if (captionTransitionTimeoutRef.current !== null) {
            window.clearTimeout(captionTransitionTimeoutRef.current);
          }
          setOutgoingCaption(allCaptionLines[visibleLineIndex]);
          captionTransitionTimeoutRef.current = window.setTimeout(() => {
            if (!isCurrentPlaybackRun()) return;
            setOutgoingCaption("");
            captionTransitionTimeoutRef.current = null;
          }, 320);
        }

        setCaptions({
          current: allCaptionLines[nextIndex],
          next: allCaptionLines[nextIndex + 1] || "",
        });
        setCaptionIndex(nextIndex);
        visibleLineIndex = nextIndex;
      };

      showCaptionLine(0);
      setOutgoingCaption("");
      await resizeWindow(ACTIVE_SIZE);

      let shouldStop = false;
      const stopReading = () => {
        shouldStop = true;
        abortController.abort();
      };
      browserWindow.stopReading = stopReading;

      const fetchAudio = async (textChunk: string) => {
        const audioBlob = await requestSpeechAudio(
          textChunk,
          voiceRef.current,
          abortController.signal,
        );
        if (!isCurrentPlaybackRun()) {
          throw new DOMException("Reading cancelled", "AbortError");
        }
        return audioBlob;
      };

      const playAudio = (
        url: string,
        captionGroup: { lines: string[]; startIndex: number },
      ) =>
        new Promise<void>((resolve, reject) => {
          const audio = audioRef.current;
          if (!audio) return resolve();

          const lineWeights = captionGroup.lines.map((line) =>
            Math.max(1, line.replace(/\s/g, "").length),
          );
          const totalWeight = lineWeights.reduce((sum, weight) => sum + weight, 0);
          const syncCaptionToPlayback = () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
            const playbackWeight =
              Math.min(0.999, audio.currentTime / audio.duration) * totalWeight;
            let cumulativeWeight = 0;
            let localLineIndex = 0;
            for (let index = 0; index < lineWeights.length; index += 1) {
              cumulativeWeight += lineWeights[index];
              if (playbackWeight < cumulativeWeight) {
                localLineIndex = index;
                break;
              }
            }
            showCaptionLine(captionGroup.startIndex + localLineIndex);
          };

          showCaptionLine(captionGroup.startIndex);
          audio.src = url;
          audio.preservesPitch = true;
          audio.playbackRate = playbackSpeedRef.current;
          let playbackCheck = 0;
          audio.onended = () => {
            syncCaptionToPlayback();
            window.clearInterval(playbackCheck);
            resolve();
          };
          audio.onerror = () => {
            window.clearInterval(playbackCheck);
            reject(new Error("Audio playback failed"));
          };
          playbackCheck = window.setInterval(() => {
            if (!isCurrentPlaybackRun()) {
              window.clearInterval(playbackCheck);
              resolve();
            } else if (shouldStop) {
              audio.pause();
              window.clearInterval(playbackCheck);
              resolve();
            } else {
              syncCaptionToPlayback();
            }
          }, 100);
          audio.play().catch((error) => {
            window.clearInterval(playbackCheck);
            reject(error);
          });
        });

      try {
        let nextAudio = fetchAudio(captionGroups[0].text);

        for (let index = 0; index < captionGroups.length; index += 1) {
          if (shouldStop) break;
          const currentAudioBlob = await nextAudio;
          if (!isCurrentPlaybackRun()) {
            break;
          }
          if (index + 1 < captionGroups.length) {
            nextAudio = fetchAudio(captionGroups[index + 1].text);
          }
          const currentUrl = URL.createObjectURL(currentAudioBlob);
          setStatus("reading");
          setStatusMessage("Reading selected text");
          try {
            await playAudio(currentUrl, captionGroups[index]);
          } finally {
            URL.revokeObjectURL(currentUrl);
          }
        }

        if (!isCurrentPlaybackRun()) {
          return;
        }

        if (!shouldStop) {
          resetToReady();
          if (!settingsOpenedDuringPlaybackRef.current) {
            await resizeWindow(COMPACT_SIZE);
            await hideWidget();
          }
        } else {
          resetToReady();
          await resizeWindow(COMPACT_SIZE);
        }
      } catch (error) {
        console.error("Speech playback failed", error);
        if (abortController.signal.aborted) {
          if (isCurrentPlaybackRun()) {
            resetToReady();
            await resizeWindow(COMPACT_SIZE);
          }
          return;
        }
        if (!isCurrentPlaybackRun()) {
          return;
        }
        const message = getErrorMessage(error);
        setStatus("error");
        setErrorCause(message);
        setStatusMessage("Couldn’t play the selection");
        setCaptions({ current: "", next: "" });
        setOutgoingCaption("");
        await resizeWindow(COMPACT_SIZE);
      } finally {
        if (activeAbortControllerRef.current === abortController) {
          activeAbortControllerRef.current = null;
        }
        if (browserWindow.stopReading === stopReading) {
          delete browserWindow.stopReading;
        }
      }
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  const handleShortcutKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!isRecordingShortcut) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setIsRecordingShortcut(false);
      setShortcutInput(shortcutRef.current);
      setSettingsFeedback("Shortcut change cancelled.");
      return;
    }

    const modifierKeys = ["Control", "Alt", "Shift", "Meta"];
    if (modifierKeys.includes(event.key)) return;

    const parts: string[] = [];
    if (event.ctrlKey) parts.push("ctrl");
    if (event.altKey) parts.push("alt");
    if (event.shiftKey) parts.push("shift");
    if (event.metaKey) parts.push("meta");

    const key = event.key === " " ? "space" : event.key.toLowerCase();
    parts.push(key);
    const nextShortcut = parts.join("+");
    const validationMessage = validateShortcut(nextShortcut);
    if (validationMessage) {
      setSettingsFeedback(validationMessage);
      return;
    }
    setShortcutInput(nextShortcut);
    setIsRecordingShortcut(false);
    setSettingsFeedback("Shortcut captured. Save to apply it.");
  };

  const handleSaveShortcut = async () => {
    const validationMessage = validateShortcut(shortcutInput);
    if (validationMessage) {
      setSettingsFeedback(validationMessage);
      return;
    }

    try {
      await invoke("update_shortcut", { newShortcut: shortcutInput });
      localStorage.setItem("shortcut", shortcutInput);
      shortcutRef.current = shortcutInput;
      await emit("settings_updated", { shortcut: shortcutInput });
      setStatus("saved");
      setStatusMessage("Settings saved");
      resetToReady();
      await closeSettingsWindow();
    } catch (error) {
      console.error("Shortcut update failed", error);
      setSettingsFeedback("That shortcut isn’t available. Try another combination.");
    }
  };

  const handlePreviewVoice = async () => {
    setIsPreviewing(true);
    setSettingsFeedback("");
    try {
      const audioBlob = await requestSpeechAudio(
        "This is how SayIt sounds.",
        voice,
      );
      const url = URL.createObjectURL(audioBlob);
      let shouldRevokeUrl = true;
      const audio = audioRef.current;
      if (!audio) {
        URL.revokeObjectURL(url);
        setIsPreviewing(false);
        return;
      }
      audio.src = url;
      audio.preservesPitch = true;
      audio.playbackRate = playbackSpeedRef.current;
      audio.onended = () => {
        if (shouldRevokeUrl) {
          URL.revokeObjectURL(url);
          shouldRevokeUrl = false;
        }
        setIsPreviewing(false);
      };
      try {
        await audio.play();
      } catch (error) {
        if (shouldRevokeUrl) {
          URL.revokeObjectURL(url);
          shouldRevokeUrl = false;
        }
        throw error;
      }
    } catch (error) {
      console.error("Voice preview failed", error);
      setIsPreviewing(false);
      setSettingsFeedback("Voice preview is unavailable right now.");
    }
  };

  const closeSettingsWindow = async () => {
    setSettingsFeedback("");
    setIsRecordingShortcut(false);
    await emit("settings_closed");
    await getCurrentWindow().hide();
  };

  const toggleSettings = async () => {
    if (isSettingsWindow) {
      await closeSettingsWindow();
      return;
    }

    setHasSeenIntro(true);
    markIntroSeen();
    if (isActive) settingsOpenedDuringPlaybackRef.current = true;
    await openSettingsWindow();
  };

  const handleStop = async () => {
    const browserWindow = window as SayItWindow;
    activeAbortControllerRef.current?.abort();
    browserWindow.stopReading?.();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    resetToReady();
    await resizeWindow(COMPACT_SIZE);
  };

  const handleRetry = async () => {
    if (!lastCapturedText.trim()) return;
    setErrorCause("");
    await emit("text_captured", lastCapturedText);
  };

  const cyclePlaybackSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.findIndex(
      (speed) => speed === playbackSpeed,
    );
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
  };

  const handleDismiss = async () => {
    if (isSettingsWindow) {
      await closeSettingsWindow();
      return;
    }

    await handleStop();
    settingsOpenedDuringPlaybackRef.current = false;
    const settingsWindow = await WebviewWindow.getByLabel("settings");
    await settingsWindow?.hide();
    await resizeWindow(COMPACT_SIZE);
    await hideWidget();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (isRecordingShortcut) {
        event.preventDefault();
        setIsRecordingShortcut(false);
        setShortcutInput(shortcutRef.current);
        setSettingsFeedback("Shortcut change cancelled.");
        return;
      }

      if (isActiveRef.current) {
        event.preventDefault();
        void handleStop();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecordingShortcut]);

  const statusLabel = {
    ready: "Ready",
    loading: "Preparing",
    reading: "Reading",
    saved: "Saved",
    error: "Needs attention",
  }[status];

  return (
    <main
      className={`app-shell ${isSettingsWindow ? "is-expanded is-settings-window" : ""} ${isActive ? "is-captioning" : ""} ${surfaceMode === "solid" ? "is-solid" : ""}`}
      onPointerDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button, input, select")
        ) {
          return;
        }
        getCurrentWindow().startDragging();
      }}
    >
      <audio ref={audioRef} crossOrigin="anonymous" hidden />

      {isSettingsWindow ? (
        <SettingsWindow
          status={status}
          shortcutInput={shortcutInput}
          isRecordingShortcut={isRecordingShortcut}
          settingsFeedback={settingsFeedback}
          isPreviewing={isPreviewing}
          voice={voice}
          volume={volume}
          surfaceMode={surfaceMode}
          onCloseSettings={toggleSettings}
          onDismiss={handleDismiss}
          onStartShortcutRecording={() => {
            setIsRecordingShortcut(true);
            setSettingsFeedback("Press your new shortcut.");
          }}
          onShortcutKeyDown={handleShortcutKeyDown}
          onPreviewVoice={handlePreviewVoice}
          onVoiceChange={setVoice}
          onVolumeChange={setVolume}
          onToggleSurfaceMode={() =>
            setSurfaceMode((currentMode) =>
              currentMode === "solid" ? "glass" : "solid",
            )
          }
          onSaveShortcut={handleSaveShortcut}
        />
      ) : (
        <CompactWidget
          status={status}
          statusLabel={statusLabel}
          statusMessage={statusMessage}
          isActive={isActive}
          captions={captions}
          outgoingCaption={outgoingCaption}
          captionIndex={captionIndex}
          errorCause={errorCause}
          lastCapturedText={lastCapturedText}
          hasSeenIntro={hasSeenIntro}
          playbackSpeed={playbackSpeed}
          onRetry={handleRetry}
          onCyclePlaybackSpeed={cyclePlaybackSpeed}
          onToggleSettings={toggleSettings}
          onDismiss={handleDismiss}
        />
      )}
    </main>
  );
}

export default App;
