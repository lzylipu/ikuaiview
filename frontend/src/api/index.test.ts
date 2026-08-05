import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_UNAUTHORIZED_EVENT,
  ApiError,
  ApiSchemaError,
  __resetApiStateForTests,
  createPairing,
  fetchAuthStatus,
  fetchFullConfig,
  fetchHealth,
  fetchMe,
  fetchOuiEntries,
  fetchSessions,
  fetchTrafficHistory,
  setupAdmin,
  updateConfig,
  updateDeviceOverride,
} from './index';

const configFixture = (revision: number, legacy = false) => ({
  router_type: 'ikuai',
  revision,
  ...(legacy ? {
    ikuai_host: '192.168.88.1', ikuai_port: 443, ikuai_scheme: 'https',
    ikuai_username: 'admin', ikuai_configured: true,
  } : {
    router_host: '192.168.88.1', router_port: 443, router_scheme: 'https',
    router_username: 'admin', router_configured: true,
  }),
  password_set: true,
  accept_invalid_certs: false,
  allow_insecure_router_http: false,
  poll_interval_secs: 5,
  probe_interval_secs: 60,
  db_raw_retention_days: 7,
  db_total_retention_days: 90,
  latency_good_ms: 30,
  latency_poor_ms: 100,
  theme: 'system',
  wizard_completed: true,
});

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const errorResponse = (status: number, code: string) => jsonResponse({
  error: { code, message: code, fields: {}, request_id: 'request-1' },
}, status);

beforeEach(() => {
  __resetApiStateForTests();
  document.cookie = '__Host-ikuaiview_csrf=; Max-Age=0; Secure; Path=/';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('central API client', () => {
  it('uses same-origin credentials, encodes queries, and forwards cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ points: [], interval_secs: 5 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await fetchTrafficHistory(100, 200, { wanName: 'wan/a + backup' }, controller.signal);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/traffic?start=100&end=200&wan_name=wan%2Fa+%2B+backup');
    expect(options.credentials).toBe('same-origin');
    expect(options.method).toBe('GET');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps caller cancellation connected while the response body is being read', async () => {
    const controller = new AbortController();
    let bodyStarted!: () => void;
    const started = new Promise<void>(resolve => { bodyStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => {
          bodyStarted();
          return new Promise<string>((_resolve, reject) => {
            const rejectAbort = () => reject(signal.reason);
            if (signal.aborted) rejectAbort();
            else signal.addEventListener('abort', rejectAbort, { once: true });
          });
        },
      } as Response);
    }));

    const request = fetchTrafficHistory(100, 200, undefined, controller.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();

    await rejection;
  });

  it('keeps the request timeout active while the response body is being read', async () => {
    vi.useFakeTimers();
    let bodyStarted!: () => void;
    const started = new Promise<void>(resolve => { bodyStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => {
          bodyStarted();
          return new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      } as Response);
    }));

    const request = fetchTrafficHistory(100, 200);
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await started;
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
  });

  it('reads only the exact CSRF cookie name for mutations', async () => {
    document.cookie = 'prefix__Host-ikuaiview_csrf=wrong; Secure; Path=/';
    document.cookie = '__Host-ikuaiview_csrf=correct-token; Secure; Path=/';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await updateDeviceOverride('AA:BB', { custom_name: 'AP' });

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('correct-token');
    expect(options.credentials).toBe('same-origin');
  });

  it('publishes a unified event and preserves the standard 401 envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(401, 'unauthorized')));
    const listener = vi.fn();
    window.addEventListener(API_UNAUTHORIZED_EVENT, listener);

    await expect(fetchFullConfig()).rejects.toMatchObject({
      status: 401,
      detail: { code: 'unauthorized', request_id: 'request-1' },
    });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(API_UNAUTHORIZED_EVENT, listener);
  });

  it('does not invalidate an authenticated administrator for a pairing reauthentication failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(401, 'invalid_password'))
      .mockResolvedValueOnce(jsonResponse({ setup_required: false, authenticated: true, oidc: null }));
    vi.stubGlobal('fetch', fetchMock);
    const listener = vi.fn();
    window.addEventListener(API_UNAUTHORIZED_EVENT, listener);

    await expect(createPairing('Wall display', 'admin', 'wrong-password'))
      .rejects.toMatchObject({ status: 401, detail: { code: 'invalid_password' } });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/pairings',
      '/api/auth/status',
    ]);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(API_UNAUTHORIZED_EVENT, listener);
  });

  it('invalidates authentication when a pairing 401 belongs to an expired session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(401, 'invalid_password'))
      .mockResolvedValueOnce(jsonResponse({ setup_required: false, authenticated: false, oidc: null }));
    vi.stubGlobal('fetch', fetchMock);
    const listener = vi.fn();
    window.addEventListener(API_UNAUTHORIZED_EVENT, listener);

    await expect(createPairing('Wall display', 'viewer', 'stale-password'))
      .rejects.toMatchObject({ status: 401, detail: { code: 'invalid_password' } });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(API_UNAUTHORIZED_EVENT, listener);
  });

  it('normalizes an omitted OUI vendor without discarding other lookup results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      entries: [
        { mac: 'AA:BB:CC:00:00:01', vendor: 'Example Networks' },
        { mac: '00:11:22:33:44:55' },
      ],
    })));

    await expect(fetchOuiEntries(['AA:BB:CC:00:00:01', '00:11:22:33:44:55']))
      .resolves.toEqual([
        { mac: 'AA:BB:CC:00:00:01', vendor: 'Example Networks' },
        { mac: '00:11:22:33:44:55', vendor: null },
      ]);
  });

  it('rejects successful responses that do not match their runtime schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', version: 12 })));
    await expect(fetchHealth()).rejects.toBeInstanceOf(ApiSchemaError);
  });
});

describe('authentication schemas', () => {
  it('creates the first administrator without broadcasting an invalid setup token as session expiry', async () => {
    const user = {
      username: 'admin',
      display_name: 'Local administrator',
      role: 'admin',
      session_kind: 'standard',
      auth_method: 'password',
      provider_name: null,
      capabilities: ['read', 'configure', 'manage_devices', 'manage_sessions'],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(401, 'invalid_setup_token'))
      .mockResolvedValueOnce(jsonResponse(user, 201));
    vi.stubGlobal('fetch', fetchMock);
    const listener = vi.fn();
    window.addEventListener(API_UNAUTHORIZED_EVENT, listener);

    await expect(setupAdmin('invalid', 'admin', 'correct-horse-battery'))
      .rejects.toMatchObject({ status: 401, detail: { code: 'invalid_setup_token' } });
    await expect(setupAdmin('a'.repeat(43), 'admin', 'correct-horse-battery'))
      .resolves.toEqual(user);

    expect(listener).not.toHaveBeenCalled();
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/auth/setup');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      token: 'a'.repeat(43),
      username: 'admin',
      password: 'correct-horse-battery',
    });
    window.removeEventListener(API_UNAUTHORIZED_EVENT, listener);
  });

  it('parses the public OIDC status without exposing provider configuration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      setup_required: false,
      authenticated: false,
      oidc: { provider_name: 'Example Identity', available: true },
    })));

    await expect(fetchAuthStatus()).resolves.toEqual({
      setup_required: false,
      authenticated: false,
      oidc: { provider_name: 'Example Identity', available: true },
    });
  });

  it('rejects malformed OIDC availability and authentication methods', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        setup_required: false,
        authenticated: false,
        oidc: { provider_name: 'Example Identity', available: 'yes' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        username: 'admin',
        display_name: 'Administrator',
        role: 'admin',
        session_kind: 'standard',
        auth_method: 'saml',
        provider_name: null,
        capabilities: ['read'],
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAuthStatus()).rejects.toBeInstanceOf(ApiSchemaError);
    await expect(fetchMe()).rejects.toBeInstanceOf(ApiSchemaError);
  });

  it('parses identity and authentication source for users and sessions', async () => {
    const identity = {
      username: 'alice@example.test',
      display_name: 'Alice Example',
      role: 'admin',
      session_kind: 'standard',
      auth_method: 'oidc',
      provider_name: 'Example Identity',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ...identity,
        capabilities: ['read', 'manage_sessions'],
      }))
      .mockResolvedValueOnce(jsonResponse({
        sessions: [{
          id: 'session-1',
          ...identity,
          label: null,
          created_at: 1,
          last_seen_at: 2,
          expires_at: 3,
          active: true,
        }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMe()).resolves.toEqual({
      ...identity,
      capabilities: ['read', 'manage_sessions'],
    });
    await expect(fetchSessions()).resolves.toEqual([expect.objectContaining(identity)]);
  });
});

describe('configuration revisions', () => {
  it('normalizes legacy ikuai aliases and serializes writes with the latest revision', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configFixture(3, true)))
      .mockResolvedValueOnce(jsonResponse({ saved: ['theme'], requires_restart: [], revision: 4 }))
      .mockResolvedValueOnce(jsonResponse({ saved: ['poll_interval_secs'], requires_restart: [], revision: 5 }));
    vi.stubGlobal('fetch', fetchMock);

    const config = await fetchFullConfig();
    expect(config.router_host).toBe('192.168.88.1');
    const first = updateConfig({ theme: 'dark' });
    const second = updateConfig({ poll_interval_secs: 7 });
    await Promise.all([first, second]);

    const firstBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    const secondBody = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body));
    expect(firstBody.expected_revision).toBe(3);
    expect(secondBody.expected_revision).toBe(4);
  });

  it('reloads after a conflict without retrying the mutation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configFixture(8)))
      .mockResolvedValueOnce(errorResponse(409, 'conflict'))
      .mockResolvedValueOnce(jsonResponse(configFixture(9)));
    vi.stubGlobal('fetch', fetchMock);
    await fetchFullConfig();

    await expect(updateConfig({ theme: 'dark' })).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'PUT')).toHaveLength(1);
  });

  it('rejects mutations queued before a conflict without sending them', async () => {
    let resolveConflict!: (response: Response) => void;
    const conflict = new Promise<Response>((resolve) => { resolveConflict = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configFixture(8)))
      .mockImplementationOnce(() => conflict)
      .mockResolvedValueOnce(jsonResponse(configFixture(9)));
    vi.stubGlobal('fetch', fetchMock);
    await fetchFullConfig();

    const first = updateConfig({ theme: 'dark' });
    const queuedBeforeConflict = updateConfig({ poll_interval_secs: 7 });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveConflict(errorResponse(409, 'conflict'));
    await expect(first).rejects.toMatchObject({ status: 409 });
    await expect(queuedBeforeConflict).rejects.toMatchObject({
      status: 409,
      detail: { code: 'stale_config_mutation' },
    });

    const putCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'PUT');
    expect(putCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('traffic v4 schema', () => {
  const trafficV4Fixture = () => ({
    schema_version: 4,
    router: {
      id: 'router-uuid',
      hardware_identity: 'serial-1',
      fallback_target: '192.168.88.1',
      identity_source: 'hardware',
      first_seen_at_ms: 10,
      last_seen_at_ms: 20,
    },
    interface: {
      id: '*2',
      name: 'ether1',
      kind: 'wan',
      hardware_id: '*2',
      aggregate: false,
      first_seen_at_ms: 11,
      last_seen_at_ms: 20,
    },
    wan_interfaces: [{
      id: '*2',
      name: 'ether1',
      kind: 'wan',
      hardware_id: '*2',
      aggregate: false,
      first_seen_at_ms: 11,
      last_seen_at_ms: 20,
    }],
    wan_names: ['ether1'],
    points: [{
      timestamp_ms: 1_000,
      started_at_ms: 1_000,
      ended_at_ms: 2_000,
      duration_ms: 900,
      download_bps: 80,
      upload_bps: 40,
      download_bytes: '9',
      upload_bytes: '5',
      exact_download_bytes: '8',
      exact_upload_bytes: '4',
      estimated_download_bytes: '1',
      estimated_upload_bytes: '1',
      exact_duration_ms: 800,
      estimated_duration_ms: 100,
      sample_count: 2,
      estimated: true,
      complete: false,
      wan_name: 'ether1',
    }],
    totals: {
      download_bytes: '9',
      upload_bytes: '5',
      exact_download_bytes: '8',
      exact_upload_bytes: '4',
      estimated_download_bytes: '1',
      estimated_upload_bytes: '1',
      estimated: true,
      complete: false,
      coverage_ratio: 0.9,
    },
    coverage: {
      requested_duration_ms: 1_000,
      exact_duration_ms: 800,
      estimated_duration_ms: 100,
      covered_duration_ms: 900,
      completeness: 0.9,
      gap_count: 1,
    },
    bucket_size_ms: 1_000,
    interval_secs: 1,
  });

  it('parses canonical metadata and queries a stable interface id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(trafficV4Fixture()));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchTrafficHistory(100, 200, { interfaceId: '*2' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/traffic?start=100&end=200&interface_id=*2');
    expect(response.schema_version).toBe(4);
    expect(response.router?.id).toBe('router-uuid');
    expect(response.interface?.id).toBe('*2');
    expect(response.wan_interfaces?.[0]?.id).toBe('*2');
    expect(response.coverage).toEqual(expect.objectContaining({
      exact_duration_ms: 800,
      estimated_duration_ms: 100,
      gap_count: 1,
    }));
    expect(response.points[0]).toEqual(expect.objectContaining({
      exact_download_bytes: '8',
      estimated_download_bytes: '1',
      exact_duration_ms: 800,
      estimated_duration_ms: 100,
    }));
  });

  it('rejects a schema-versioned response with missing canonical metadata', async () => {
    const fixture = trafficV4Fixture();
    const invalid = { ...fixture, coverage: undefined };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(invalid)));

    await expect(fetchTrafficHistory(100, 200)).rejects.toBeInstanceOf(ApiSchemaError);
  });
});
