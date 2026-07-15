import { describe, expect, it } from "vitest";
import { formatShortcut, validateShortcut } from "./shortcut";

describe("shortcut helpers", () => {
  it("formats stored shortcuts for display", () => {
    expect(formatShortcut("alt+s")).toBe("Alt + S");
    expect(formatShortcut("ctrl+shift+space")).toBe("Ctrl + Shift + Space");
  });

  it("requires a non-modifier key", () => {
    expect(validateShortcut("ctrl")).toBe(
      "Use a shortcut with a letter, number, or function key.",
    );
    expect(validateShortcut("ctrl+shift")).toBe(
      "Use a shortcut with a letter, number, or function key.",
    );
  });

  it("requires at least one modifier", () => {
    expect(validateShortcut("s")).toBe(
      "Add at least one modifier such as Alt, Ctrl, or Shift.",
    );
  });

  it("rejects reserved operating-system and editing shortcuts", () => {
    expect(validateShortcut("ctrl+c")).toBe("Ctrl + C is reserved for copy.");
    expect(validateShortcut("alt+tab")).toBe(
      "Alt + Tab is reserved for app switching.",
    );
  });

  it("accepts available global shortcuts", () => {
    expect(validateShortcut("alt+s")).toBe("");
    expect(validateShortcut("ctrl+shift+k")).toBe("");
  });
});
