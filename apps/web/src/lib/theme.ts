export type ThemePreference = "system" | "light" | "dark";
const STORAGE_KEY = "gezycbt-theme";

export function readThemePreference(): ThemePreference {
  if (typeof localStorage === "undefined") return "system";
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  if (typeof localStorage !== "undefined")
    localStorage.setItem(STORAGE_KEY, preference);
  window.dispatchEvent(
    new CustomEvent("gezycbt-theme-change", { detail: preference }),
  );
}

export function cycleTheme(preference: ThemePreference): ThemePreference {
  return preference === "system"
    ? "light"
    : preference === "light"
      ? "dark"
      : "system";
}

export function initializeTheme(): ThemePreference {
  const preference = readThemePreference();
  applyTheme(preference);
  return preference;
}
