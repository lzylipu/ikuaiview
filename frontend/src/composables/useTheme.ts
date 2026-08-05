import { watch } from 'vue';
import type { ThemeMode } from '@/stores/theme';

/**
 * Composable that syncs theme changes to additional side effects
 * like ECharts dark mode.
 */
export function useTheme(mode: import('vue').Ref<ThemeMode>) {
  // Watch for theme changes and dispatch a custom event for ECharts
  watch(mode, (newMode) => {
    // Custom event that chart components can listen to
    window.dispatchEvent(new CustomEvent('theme-changed', {
      detail: { mode: newMode },
    }));
  });

  return {};
}
