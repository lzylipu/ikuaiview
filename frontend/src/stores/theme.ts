import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ThemeMode = 'dark' | 'light';
export type ThemePreference = 'system' | 'dark' | 'light';

const THEME_STORAGE_KEY = 'ikuaiview-theme';

/** Resolve the effective visual theme from the preference. */
function resolveTheme(pref: ThemePreference): ThemeMode {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return pref;
}

/**
 * Theme store — manages dark/light/system mode with localStorage persistence.
 */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>('dark');
  const preference = ref<ThemePreference>('system');

  let systemQuery: MediaQueryList | null = null;

  function onSystemChange(e: MediaQueryListEvent) {
    if (preference.value === 'system') {
      apply(e.matches ? 'dark' : 'light');
    }
  }

  function init() {
    // Restore saved preference
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      preference.value = stored;
    } else {
      // Default: system
      preference.value = 'system';
    }

    // Listen for system theme changes
    systemQuery?.removeEventListener('change', onSystemChange);
    systemQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemQuery.addEventListener('change', onSystemChange);

    // Apply resolved theme
    apply(resolveTheme(preference.value));
  }

  function toggle() {
    const current = mode.value;
    setPreference(current === 'dark' ? 'light' : 'dark');
  }

  function setPreference(pref: ThemePreference) {
    preference.value = pref;
    const resolved = resolveTheme(pref);
    mode.value = resolved;
    apply(resolved);
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  }

  function apply(m: ThemeMode) {
    mode.value = m;
    document.documentElement.setAttribute('data-theme', m);
  }

  return { mode, preference, init, toggle, setPreference };
});
