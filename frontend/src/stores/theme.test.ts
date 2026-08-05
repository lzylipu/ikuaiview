import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useThemeStore } from './theme';

interface MutableMediaQuery extends MediaQueryList {
  emit(matches: boolean): void;
}

function mediaQuery(initial: boolean): MutableMediaQuery {
  let listener: ((event: MediaQueryListEvent) => void) | null = null;
  return {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type, next) => {
      listener = next as (event: MediaQueryListEvent) => void;
    }),
    removeEventListener: vi.fn((_type, current) => {
      if (listener === current) listener = null;
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    emit(matches: boolean) {
      listener?.({ matches } as MediaQueryListEvent);
    },
  };
}

describe('theme store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('tracks system changes only while the system preference is active', () => {
    const query = mediaQuery(false);
    vi.spyOn(window, 'matchMedia').mockReturnValue(query);
    const store = useThemeStore();

    store.init();
    expect(store.mode).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    query.emit(true);
    expect(store.mode).toBe('dark');

    store.setPreference('light');
    query.emit(true);
    expect(store.mode).toBe('light');
    expect(localStorage.getItem('ikuaiview-theme')).toBe('light');
  });

  it('replaces its system media listener when initialized again', () => {
    const first = mediaQuery(false);
    const second = mediaQuery(true);
    vi.spyOn(window, 'matchMedia')
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValue(second);
    const store = useThemeStore();

    store.init();
    store.init();

    expect(first.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(second.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
