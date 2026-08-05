/**
 * MAC vendor lookup via backend OUI API with client-side batching & cache.
 *
 * Uses the IEEE OUI database (~40K prefixes) loaded in the Rust backend.
 * Results are cached in-memory and shared across components.
 *
 * Usage:
 *   const { vendorFor } = useMacVendor();
 *   const vendor = await vendorFor('dc:a6:32:ab:cd:ef');  // "Raspberry Pi"
 */
import { ref } from 'vue';
import { fetchOuiEntries } from '@/api';

// ── In-memory cache: "AABBCC" → "Apple Inc." ──────────────
const cache = ref<Map<string, string>>(new Map());

// ── Batch request queue ────────────────────────────────────
const PENDING_INTERVAL_MS = 50;
let pendingMacs: Map<string, { resolve: (v: string) => void }> = new Map();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function flushBatch() {
  if (pendingMacs.size === 0) return;

  const macs = Array.from(pendingMacs.keys());
  const resolvers = new Map(pendingMacs);
  pendingMacs = new Map();

  try {
    const entries = await fetchOuiEntries(macs);
    for (const entry of entries) {
      const vendor = entry.vendor || '—';
      cache.value.set(normalisePrefix(entry.mac), vendor);
      const r = resolvers.get(entry.mac.toLowerCase());
      if (r) r.resolve(vendor);
    }
  } catch {
    // API unavailable: resolve all pending as unknown
    for (const [mac, r] of resolvers) {
      cache.value.set(normalisePrefix(mac), '—');
      r.resolve('—');
    }
  }
}

function normalisePrefix(mac: string): string {
  return mac.replace(/[^0-9a-fA-F]/g, '').substring(0, 6).toUpperCase();
}

/**
 * Schedule a batch flush. Returns a Promise that resolves when the
 * vendor is known for this specific MAC.
 */
function schedule(mac: string): Promise<string> {
  const pf = normalisePrefix(mac);

  // Cache hit
  const cached = cache.value.get(pf);
  if (cached !== undefined) return Promise.resolve(cached);

  // Already pending
  const lower = mac.toLowerCase();
  if (pendingMacs.has(lower)) {
    return new Promise<string>((resolve) => {
      pendingMacs.set(lower, { resolve });
    });
  }

  // Queue it
  const promise = new Promise<string>((resolve) => {
    pendingMacs.set(lower, { resolve });
  });

  if (!debounceTimer) {
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flushBatch();
    }, PENDING_INTERVAL_MS);
  }

  return promise;
}

// ── Public API ──────────────────────────────────────────

export function useMacVendor() {
  /** Synchronous optimistic lookup (returns cached or empty string). */
  function vendorCached(mac: string): string {
    const pf = normalisePrefix(mac);
    return cache.value.get(pf) || '';
  }

  /** Async lookup — resolves when vendor is known (may trigger API call). */
  async function vendorFor(mac: string): Promise<string> {
    return schedule(mac);
  }

  return { vendorCached, vendorFor, cache };
}
