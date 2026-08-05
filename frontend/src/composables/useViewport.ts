import { ref, onMounted, onUnmounted } from 'vue';

const COMPACT_QUERY = '(max-width: 820px), (max-height: 520px) and (pointer: coarse)';

/** Reactive layout capabilities based on usable size and pointer precision. */
export function useViewport() {
  const isCompact = ref(false);
  const isCoarsePointer = ref(false);
  // Kept as an alias so existing views do not couple layout to orientation.
  const isPortrait = isCompact;

  let compactQuery: MediaQueryList | null = null;
  let coarseQuery: MediaQueryList | null = null;

  function update() {
    isCompact.value = compactQuery?.matches ?? false;
    isCoarsePointer.value = coarseQuery?.matches ?? false;
  }

  onMounted(() => {
    compactQuery = window.matchMedia(COMPACT_QUERY);
    coarseQuery = window.matchMedia('(pointer: coarse)');
    update();
    compactQuery.addEventListener('change', update);
    coarseQuery.addEventListener('change', update);
  });

  onUnmounted(() => {
    compactQuery?.removeEventListener('change', update);
    coarseQuery?.removeEventListener('change', update);
  });

  return { isCompact, isPortrait, isCoarsePointer };
}
