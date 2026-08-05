import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from './auth';
import type { AuthUser } from '@/api';

const api = vi.hoisted(() => ({
  fetchAuthStatus: vi.fn(),
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  pair: vi.fn(),
  setupAdmin: vi.fn(),
}));

vi.mock('@/api', () => ({
  API_UNAUTHORIZED_EVENT: 'ikuaiview:unauthorized',
  ...api,
}));

const admin: AuthUser = {
  username: 'admin',
  display_name: 'Local administrator',
  role: 'admin' as const,
  session_kind: 'standard',
  auth_method: 'password',
  provider_name: null,
  capabilities: ['read', 'configure', 'manage_devices', 'manage_sessions'],
};
const viewer: AuthUser = {
  username: 'admin',
  display_name: 'Hall display',
  role: 'viewer' as const,
  session_kind: 'fixed',
  auth_method: 'pairing',
  provider_name: null,
  capabilities: ['read'],
};

let store: ReturnType<typeof useAuthStore>;

beforeEach(() => {
  setActivePinia(createPinia());
  store = useAuthStore();
});

afterEach(() => store.stopUnauthorizedListener());

describe('auth store', () => {
  it('represents setup-required without requesting a protected identity', async () => {
    api.fetchAuthStatus.mockResolvedValue({ setup_required: true, authenticated: false, oidc: null });
    await store.initialize();
    expect(store.state).toBe('setup_required');
    expect(store.authenticated).toBe(false);
    expect(api.fetchMe).not.toHaveBeenCalled();
  });

  it('loads an authenticated viewer and enforces its capabilities', async () => {
    api.fetchAuthStatus.mockResolvedValue({
      setup_required: false,
      authenticated: true,
      oidc: { provider_name: 'Example Identity', available: true },
    });
    api.fetchMe.mockResolvedValue(viewer);
    await store.initialize();
    expect(store.authenticated).toBe(true);
    expect(store.can('read')).toBe(true);
    expect(store.can('manage_devices')).toBe(false);
    expect(store.isAdmin).toBe(false);
    expect(store.oidc).toEqual({ provider_name: 'Example Identity', available: true });
  });

  it('refreshes provider availability without changing the current session state', async () => {
    store.state = 'authenticated';
    store.user = admin;
    api.fetchAuthStatus.mockResolvedValue({
      setup_required: false,
      authenticated: true,
      oidc: { provider_name: 'Example Identity', available: false },
    });

    await store.refreshOidcStatus();

    expect(store.state).toBe('authenticated');
    expect(store.user).toEqual(admin);
    expect(store.oidc).toEqual({ provider_name: 'Example Identity', available: false });
  });

  it('adopts login and pairing responses as the current session', async () => {
    api.login.mockResolvedValue(admin);
    await store.login(' admin ', 'secret');
    expect(api.login).toHaveBeenCalledWith('admin', 'secret');
    expect(store.isAdmin).toBe(true);

    api.pair.mockResolvedValue(viewer);
    await store.pair(' pairing-code ');
    expect(api.pair).toHaveBeenCalledWith('pairing-code');
    expect(store.user?.role).toBe('viewer');
  });

  it('adopts the setup response and normalizes token and username inputs', async () => {
    api.setupAdmin.mockResolvedValue(admin);

    await store.setup(`  ${'a'.repeat(43)}  `, ' Admin ', 'correct-horse-battery');

    expect(api.setupAdmin).toHaveBeenCalledWith(
      'a'.repeat(43),
      'admin',
      'correct-horse-battery',
    );
    expect(store.user).toEqual(admin);
    expect(store.authenticated).toBe(true);
  });

  it('does not Unicode case-fold setup usernames', async () => {
    api.setupAdmin.mockResolvedValue(admin);

    await store.setup('a'.repeat(43), ' Kaa ', 'correct-horse-battery');

    expect(api.setupAdmin).toHaveBeenCalledWith(
      'a'.repeat(43),
      'Kaa',
      'correct-horse-battery',
    );
  });

  it('invalidates an active session when the central client reports a 401', () => {
    store.state = 'authenticated';
    store.user = admin;
    store.startUnauthorizedListener();
    window.dispatchEvent(new CustomEvent('ikuaiview:unauthorized'));
    expect(store.state).toBe('anonymous');
    expect(store.user).toBeNull();
    expect(store.lastInvalidation).toBe('http');
  });
});
