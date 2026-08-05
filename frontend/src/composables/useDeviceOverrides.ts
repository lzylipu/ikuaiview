/**
 * Device override composable — manages user-assigned custom names and types
 * for devices. Overrides are loaded from the backend REST API and kept in a
 * reactive local map. The composable also provides helpers for display names
 * and types that prefer custom values over auto-detected ones.
 */
import { ref } from 'vue';
import type { Device } from '@/types/dashboard';
import {
  fetchDeviceOverrides,
  updateDeviceOverride as apiUpdateOverride,
} from '@/api';

interface OverrideEntry {
  custom_name: string | null;
  custom_type: string | null;
}

// This map is deliberately only an acknowledgement bridge. The WebSocket
// device list remains authoritative, so a later update from another session
// cannot be hidden by stale client state.
const overrideMap = ref<Map<string, OverrideEntry>>(new Map());
const loaded = ref(false);
let reconciliationVersion = 0;

function clearPendingOverrides() {
  reconciliationVersion++;
  if (overrideMap.value.size > 0) {
    overrideMap.value = new Map();
  }
}

/** Reconcile a complete device state received from REST or WebSocket. */
export function reconcileDeviceOverrides() {
  clearPendingOverrides();
}

export function useDeviceOverrides() {
  function getOverride(device: Device): OverrideEntry {
    return overrideMap.value.get(device.mac.toLowerCase()) ?? {
      custom_name: device.custom_name ?? null,
      custom_type: device.custom_type ?? null,
    };
  }

  /** Load all overrides from the backend. Call once on app mount. */
  async function loadOverrides() {
    try {
      await fetchDeviceOverrides();
      clearPendingOverrides();
      loaded.value = true;
    } catch (e) {
      console.error('[DeviceOverrides] Failed to load overrides:', e);
    }
  }

  /** Save a single override and update the local map immediately. */
  async function saveOverride(
    mac: string,
    custom_name: string | null,
    custom_type: string | null,
  ) {
    const versionBeforeRequest = reconciliationVersion;
    await apiUpdateOverride(mac, { custom_name, custom_type });

    // The broadcast can beat the HTTP response. Do not recreate a pending
    // entry after an authoritative device list has already arrived.
    if (reconciliationVersion !== versionBeforeRequest) return;

    const key = mac.toLowerCase();
    const newMap = new Map(overrideMap.value);
    newMap.set(key, { custom_name, custom_type });
    overrideMap.value = newMap;
  }

  /** Get the display name for a device — custom_name takes precedence. */
  function displayName(device: Device): string {
    return getOverride(device).custom_name || device.hostname;
  }

  /** Get the display type for a device — custom_type takes precedence. */
  function displayType(device: Device): string {
    return getOverride(device).custom_type || device.device_type;
  }

  /** Check whether a device has any user overrides. */
  function hasOverride(device: Device): boolean {
    const override = getOverride(device);
    return !!(override.custom_name || override.custom_type);
  }

  return {
    overrideMap,
    loaded,
    loadOverrides,
    saveOverride,
    getOverride,
    displayName,
    displayType,
    hasOverride,
  };
}
