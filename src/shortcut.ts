const RESERVED_SHORTCUTS = new Map([
  ["ctrl+c", "Ctrl + C is reserved for copy."],
  ["ctrl+v", "Ctrl + V is reserved for paste."],
  ["ctrl+x", "Ctrl + X is reserved for cut."],
  ["ctrl+a", "Ctrl + A is reserved for select all."],
  ["ctrl+s", "Ctrl + S is commonly used to save."],
  ["alt+tab", "Alt + Tab is reserved for app switching."],
  ["alt+f4", "Alt + F4 is reserved for closing windows."],
  ["meta+l", "Win + L is reserved for locking Windows."],
]);

export const validateShortcut = (shortcut: string) => {
  const parts = shortcut.split("+").filter(Boolean);
  const modifiers = ["ctrl", "alt", "shift", "meta"];
  const key = parts[parts.length - 1];

  if (!key || modifiers.includes(key)) {
    return "Use a shortcut with a letter, number, or function key.";
  }

  if (!parts.some((part) => modifiers.includes(part))) {
    return "Add at least one modifier such as Alt, Ctrl, or Shift.";
  }

  const reservedReason = RESERVED_SHORTCUTS.get(shortcut);
  if (reservedReason) return reservedReason;

  return "";
};

export const formatShortcut = (shortcut: string) =>
  shortcut
    .split("+")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" + ");
