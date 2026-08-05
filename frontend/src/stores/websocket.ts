import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ConnectionState } from '@/types/ws';
import type { DashboardSnapshot, DashboardUpdate } from '@/types/dashboard';
import { fetchAuthStatus } from '@/api';
import { useDashboardStore } from './dashboard';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const WATCHDOG_INTERVAL_MS = 15_000;
const MESSAGE_TIMEOUT_MS = 45_000;
const STABLE_CONNECTION_MS = 30_000;

type HandledMessage = 'snapshot' | 'message' | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasSnapshotShape(value: unknown): boolean {
  if (!isRecord(value) || typeof value.timestamp !== 'string') return false;
  const traffic = value.traffic;
  const wifi = value.wifi;
  return isRecord(value.system)
    && isRecord(value.gateway)
    && isRecord(value.interfaces)
    && isRecord(value.isp)
    && isRecord(traffic)
    && Array.isArray(traffic.points)
    && isRecord(wifi)
    && Array.isArray(wifi.devices)
    && Array.isArray(value.latency_probes)
    && isRecord(value.stability)
    && Array.isArray(value.interface_statuses);
}

/** WebSocket connection management with unbounded, jittered reconnects. */
export const useWebSocketStore = defineStore('websocket', () => {
  const connectionState = ref<ConnectionState>('disconnected');
  const reconnectAttempt = ref(0);
  const lastMessageAt = ref<number | null>(null);
  const offline = ref(typeof navigator !== 'undefined' && !navigator.onLine);
  const sessionExpired = ref(false);

  let ws: WebSocket | null = null;
  let activeUrl: string | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionalDisconnect = false;
  let generation = 0;
  let networkListenersAttached = false;

  function connect(url: string) {
    const urlChanged = activeUrl !== null && activeUrl !== url;
    activeUrl = url;
    intentionalDisconnect = false;
    sessionExpired.value = false;
    attachNetworkListeners();

    if (offline.value) {
      markDisconnected();
      return;
    }
    if (!urlChanged && ws && (
      ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING
    )) {
      return;
    }
    if (urlChanged) invalidateSocket();

    clearReconnectTimer();
    connectionState.value = 'connecting';
    const socketGeneration = ++generation;
    let opened = false;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
      ws = socket;
    } catch (error) {
      console.error('[WS] Failed to create WebSocket:', error);
      markDisconnected();
      scheduleReconnect(url);
      return;
    }

    socket.onopen = () => {
      if (!isCurrent(socket, socketGeneration)) return;
      opened = true;
      connectionState.value = 'connected';
      lastMessageAt.value = Date.now();
      const dashboardStore = useDashboardStore();
      dashboardStore.wsConnected = true;
      dashboardStore.refreshFreshness();
      startWatchdog(socket, socketGeneration);
      startStabilityTimer(socket, socketGeneration);
    };

    socket.onmessage = (event) => {
      if (!isCurrent(socket, socketGeneration)) return;
      try {
        const handled = handleMessage(JSON.parse(event.data) as unknown);
        if (handled === null) return;
        lastMessageAt.value = Date.now();
        useDashboardStore().refreshFreshness();
        if (handled === 'snapshot') resetReconnectBackoff();
      } catch (error) {
        console.error('[WS] Failed to parse message:', error);
      }
    };

    socket.onclose = (event) => {
      if (!isCurrent(socket, socketGeneration)) return;
      ws = null;
      stopWatchdog();
      clearStableTimer();
      markDisconnected();
      if (event.code === 1008) {
        markSessionExpired();
        return;
      }
      if (event.code === 1006 && !opened && !intentionalDisconnect) {
        void verifySessionBeforeReconnect(url, socketGeneration);
        return;
      }
      if (!intentionalDisconnect) scheduleReconnect(url);
    };

    socket.onerror = (event) => {
      if (isCurrent(socket, socketGeneration)) console.error('[WS] Error:', event);
    };
  }

  function disconnect() {
    intentionalDisconnect = true;
    activeUrl = null;
    clearReconnectTimer();
    stopWatchdog();
    clearStableTimer();
    detachNetworkListeners();
    invalidateSocket(1000, 'Client disconnect');
    reconnectAttempt.value = 0;
    lastMessageAt.value = null;
    markDisconnected();
  }

  function scheduleReconnect(url: string) {
    if (intentionalDisconnect || sessionExpired.value || offline.value || reconnectTimer) return;
    const exponent = Math.min(reconnectAttempt.value, 10);
    const ceiling = Math.min(RECONNECT_BASE_MS * 2 ** exponent, RECONNECT_MAX_MS);
    const delay = Math.max(250, Math.floor(Math.random() * ceiling));
    reconnectAttempt.value++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!intentionalDisconnect && !offline.value && activeUrl === url) connect(url);
    }, delay);
  }

  async function verifySessionBeforeReconnect(url: string, socketGeneration: number) {
    try {
      const status = await fetchAuthStatus();
      if (!isPendingReconnect(url, socketGeneration)) return;
      if (!status.authenticated) {
        markSessionExpired();
        return;
      }
    } catch {
      if (!isPendingReconnect(url, socketGeneration)) return;
    }
    scheduleReconnect(url);
  }

  function isPendingReconnect(url: string, socketGeneration: number): boolean {
    return generation === socketGeneration
      && activeUrl === url
      && !intentionalDisconnect
      && !sessionExpired.value;
  }

  function markSessionExpired() {
    sessionExpired.value = true;
    activeUrl = null;
    clearReconnectTimer();
  }

  function startWatchdog(socket: WebSocket, socketGeneration: number) {
    stopWatchdog();
    watchdogTimer = setInterval(() => {
      if (!isCurrent(socket, socketGeneration)) return;
      const dashboardStore = useDashboardStore();
      dashboardStore.refreshFreshness();

      if (lastMessageAt.value !== null
        && Date.now() - lastMessageAt.value > MESSAGE_TIMEOUT_MS) {
        restartCurrentSocket('Server message timeout');
        return;
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  function startStabilityTimer(socket: WebSocket, socketGeneration: number) {
    clearStableTimer();
    stableTimer = setTimeout(() => {
      stableTimer = null;
      if (isCurrent(socket, socketGeneration) && socket.readyState === WebSocket.OPEN) {
        resetReconnectBackoff();
      }
    }, STABLE_CONNECTION_MS);
  }

  function resetReconnectBackoff() {
    reconnectAttempt.value = 0;
    clearStableTimer();
  }

  function restartCurrentSocket(reason: string) {
    const url = activeUrl;
    if (!url || intentionalDisconnect) return;
    stopWatchdog();
    invalidateSocket(4000, reason);
    markDisconnected();
    scheduleReconnect(url);
  }

  function invalidateSocket(code?: number, reason?: string) {
    generation++;
    clearStableTimer();
    const stale = ws;
    ws = null;
    if (stale && stale.readyState < WebSocket.CLOSING) stale.close(code, reason);
  }

  function markDisconnected() {
    connectionState.value = 'disconnected';
    useDashboardStore().wsConnected = false;
  }

  function isCurrent(socket: WebSocket, socketGeneration: number) {
    return ws === socket && generation === socketGeneration;
  }

  function clearReconnectTimer() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function stopWatchdog() {
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = null;
  }

  function clearStableTimer() {
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = null;
  }

  function onOffline() {
    offline.value = true;
    clearReconnectTimer();
    stopWatchdog();
    clearStableTimer();
    invalidateSocket();
    markDisconnected();
  }

  function onOnline() {
    offline.value = false;
    if (activeUrl && !intentionalDisconnect && !sessionExpired.value) connect(activeUrl);
  }

  function attachNetworkListeners() {
    if (networkListenersAttached || typeof window === 'undefined') return;
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    networkListenersAttached = true;
  }

  function detachNetworkListeners() {
    if (!networkListenersAttached || typeof window === 'undefined') return;
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    networkListenersAttached = false;
  }

  function handleMessage(msg: unknown): HandledMessage {
    if (!isRecord(msg) || typeof msg.type !== 'string') {
      console.warn('[WS] Invalid message envelope');
      return null;
    }
    const dashboardStore = useDashboardStore();
    switch (msg.type) {
      case 'snapshot': {
        if (!hasSnapshotShape(msg.data)) {
          console.warn('[WS] Invalid snapshot message');
          return null;
        }
        dashboardStore.handleSnapshot(msg.data as unknown as DashboardSnapshot);
        return 'snapshot';
      }
      case 'update': {
        if (!isRecord(msg.data) || typeof msg.data.timestamp !== 'string') {
          console.warn('[WS] Invalid update message');
          return null;
        }
        dashboardStore.handleUpdate(msg.data as unknown as DashboardUpdate);
        return 'message';
      }
      case 'connection_status': {
        if (typeof msg.connected !== 'boolean'
          || (msg.lastPoll !== null && typeof msg.lastPoll !== 'string')) {
          console.warn('[WS] Invalid connection status message');
          return null;
        }
        dashboardStore.handleConnectionStatus(msg.connected, msg.lastPoll);
        return 'message';
      }
      default:
        console.warn('[WS] Unknown message type:', msg.type);
        return null;
    }
  }

  return {
    connectionState,
    reconnectAttempt,
    lastMessageAt,
    offline,
    sessionExpired,
    connect,
    disconnect,
  };
});
