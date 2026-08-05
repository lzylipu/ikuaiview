import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useDashboardStore } from './dashboard';
import { useWebSocketStore } from './websocket';

const apiMocks = vi.hoisted(() => ({
  fetchAuthStatus: vi.fn(),
}));

vi.mock('@/api', () => apiMocks);

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly send = vi.fn();
  readonly close = vi.fn((code?: number, reason?: string) => {
    void code;
    void reason;
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  serverClose(code = 1006, reason = 'network') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: code === 1000 } as CloseEvent);
  }

  serverMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe('websocket store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    MockWebSocket.instances.length = 0;
    apiMocks.fetchAuthStatus.mockReset();
    apiMocks.fetchAuthStatus.mockResolvedValue({
      setup_required: false, authenticated: true, oidc: null,
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps reconnecting beyond the old ten-attempt limit', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const store = useWebSocketStore();
    store.connect('wss://ikuaiview.test/ws');

    for (let attempt = 0; attempt < 12; attempt++) {
      MockWebSocket.instances.at(-1)?.serverClose();
      await vi.advanceTimersByTimeAsync(250);
    }

    expect(MockWebSocket.instances).toHaveLength(13);
    expect(store.reconnectAttempt).toBe(12);
    store.disconnect();
  });

  it('pauses while offline and reconnects immediately when the browser recovers', async () => {
    const store = useWebSocketStore();
    const dashboard = useDashboardStore();
    store.connect('wss://ikuaiview.test/ws');
    MockWebSocket.instances[0].open();

    expect(store.connectionState).toBe('connected');
    expect(dashboard.wsConnected).toBe(true);

    window.dispatchEvent(new Event('offline'));
    expect(store.offline).toBe(true);
    expect(store.connectionState).toBe('disconnected');
    expect(dashboard.wsConnected).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);

    window.dispatchEvent(new Event('online'));
    expect(store.offline).toBe(false);
    expect(MockWebSocket.instances).toHaveLength(2);
    store.disconnect();
  });

  it('resets reconnect backoff only after a valid snapshot', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const store = useWebSocketStore();
    const dashboard = useDashboardStore();
    vi.spyOn(dashboard, 'handleSnapshot').mockImplementation(() => undefined);
    store.connect('wss://ikuaiview.test/ws');

    MockWebSocket.instances[0].serverClose();
    await vi.advanceTimersByTimeAsync(250);
    MockWebSocket.instances[1].open();
    expect(store.reconnectAttempt).toBe(1);

    MockWebSocket.instances[1].serverMessage({ type: 'snapshot', data: {} });
    expect(store.reconnectAttempt).toBe(1);

    MockWebSocket.instances[1].serverMessage({
      type: 'snapshot',
      data: {
        timestamp: new Date().toISOString(),
        system: {},
        gateway: {},
        interfaces: {},
        isp: {},
        traffic: { points: [] },
        latency_probes: [],
        wifi: { devices: [] },
        stability: {},
        interface_statuses: [],
      },
    });
    expect(store.reconnectAttempt).toBe(0);
    store.disconnect();
  });

  it('resets reconnect backoff after a connection remains stable', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const store = useWebSocketStore();
    store.connect('wss://ikuaiview.test/ws');

    MockWebSocket.instances[0].serverClose();
    await vi.advanceTimersByTimeAsync(250);
    MockWebSocket.instances[1].open();
    expect(store.reconnectAttempt).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(store.reconnectAttempt).toBe(0);
    expect(MockWebSocket.instances[1].send).not.toHaveBeenCalled();
    store.disconnect();
  });

  it('stops reconnecting and exposes session expiry after policy close', async () => {
    const store = useWebSocketStore();
    store.connect('wss://ikuaiview.test/ws');

    MockWebSocket.instances[0].serverClose(1008, 'session expired');

    expect(store.connectionState).toBe('disconnected');
    expect(store.sessionExpired).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    store.disconnect();
  });

  it('rechecks authentication after an abnormal handshake close and stops when revoked', async () => {
    apiMocks.fetchAuthStatus.mockResolvedValueOnce({
      setup_required: false,
      authenticated: false,
      oidc: null,
    });
    const store = useWebSocketStore();
    store.connect('wss://ikuaiview.test/ws');

    MockWebSocket.instances[0].serverClose(1006, 'handshake rejected');
    await flushPromises();

    expect(apiMocks.fetchAuthStatus).toHaveBeenCalledOnce();
    expect(store.connectionState).toBe('disconnected');
    expect(store.sessionExpired).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    store.disconnect();
  });
});
