// Dark is the default world; light and "follow the device" are choices this browser remembers.
export type Theme = "dark" | "light" | "system";

export const THEME_LABEL: Record<Theme, string> = { dark: "Dark", light: "Light", system: "Follow device" };

export function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "system" ? t : "dark";
}

export function applyTheme(theme: Theme) {
  if (theme === "dark") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === "dark") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
  window.dispatchEvent(new Event("fairsheet:theme"));
}

export function loadSavedTheme() {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "system") document.documentElement.dataset.theme = saved;
  } catch {
    /* storage unavailable: stay dark */
  }
}
