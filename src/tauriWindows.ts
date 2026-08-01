import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { emit } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { SETTINGS_WINDOW, WINDOW_EDGE_MARGIN } from "./appConstants";

export function getCurrentWindowLabel(fallback = "main") {
  try {
    return getCurrentWindow().label;
  } catch {
    return fallback;
  }
}

export async function resizeCurrentWindow(size: LogicalSize) {
  try {
    await getCurrentWindow().setSize(size);
  } catch (error) {
    console.error("Unable to resize SayIt", error);
  }
}

export async function hideCurrentWindow() {
  try {
    await invoke("hide_window");
  } catch (commandError) {
    try {
      await getCurrentWindow().hide();
    } catch (windowError) {
      console.error("Unable to hide SayIt", commandError, windowError);
    }
  }
}

export async function showCurrentWindow() {
  try {
    const window = getCurrentWindow();
    await window.show();
    await window.setFocus();
  } catch (error) {
    console.error("Unable to show SayIt", error);
  }
}

export async function closeSettingsWindow() {
  await emit("settings_closed");
  await getCurrentWindow().hide();
}

export async function startDraggingCurrentWindow() {
  await getCurrentWindow().startDragging();
}

async function getSettingsWindowPosition() {
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
}

export async function toggleSettingsWindowVisibility() {
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
}
