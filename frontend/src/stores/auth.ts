import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  API_UNAUTHORIZED_EVENT,
  fetchAuthStatus,
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  pair as apiPair,
  setupAdmin as apiSetupAdmin,
} from '@/api';
import type { AuthStatus, AuthUser, Capability, OidcStatus } from '@/api';
import { normalizeSetupUsername } from '@/utils/setupUsername';

export type AuthState =
  | 'unknown'
  | 'checking'
  | 'setup_required'
  | 'anonymous'
  | 'authenticated';

export const useAuthStore = defineStore('auth', () => {
  const state = ref<AuthState>('unknown');
  const user = ref<AuthUser | null>(null);
  const oidc = ref<OidcStatus | null>(null);
  const lastInvalidation = ref<'http' | 'websocket' | null>(null);
  let initializePromise: Promise<void> | null = null;
  let listening = false;

  const initialized = computed(() => !['unknown', 'checking'].includes(state.value));
  const setupRequired = computed(() => state.value === 'setup_required');
  const authenticated = computed(() => state.value === 'authenticated' && user.value !== null);
  const isAdmin = computed(() => user.value?.role === 'admin');

  function can(capability: Capability): boolean {
    return user.value?.capabilities.includes(capability) ?? false;
  }

  function setAuthenticated(nextUser: AuthUser): void {
    user.value = nextUser;
    state.value = 'authenticated';
    lastInvalidation.value = null;
  }

  function setAnonymous(source: 'http' | 'websocket' | null = null): void {
    user.value = null;
    state.value = 'anonymous';
    lastInvalidation.value = source;
  }

  function onUnauthorized(): void {
    if (state.value === 'authenticated') setAnonymous('http');
  }

  function applyPublicStatus(status: AuthStatus): void {
    oidc.value = status.oidc;
  }

  function startUnauthorizedListener(): void {
    if (listening || typeof window === 'undefined') return;
    window.addEventListener(API_UNAUTHORIZED_EVENT, onUnauthorized);
    listening = true;
  }

  function stopUnauthorizedListener(): void {
    if (!listening || typeof window === 'undefined') return;
    window.removeEventListener(API_UNAUTHORIZED_EVENT, onUnauthorized);
    listening = false;
  }

  async function refresh(): Promise<void> {
    startUnauthorizedListener();
    state.value = 'checking';
    user.value = null;
    const status = await fetchAuthStatus();
    applyPublicStatus(status);
    if (status.setup_required) {
      state.value = 'setup_required';
      return;
    }
    if (!status.authenticated) {
      state.value = 'anonymous';
      return;
    }
    try {
      setAuthenticated(await fetchMe());
    } catch {
      setAnonymous('http');
    }
  }

  async function refreshOidcStatus(): Promise<OidcStatus | null> {
    const status = await fetchAuthStatus();
    applyPublicStatus(status);
    return status.oidc;
  }

  async function initialize(): Promise<void> {
    if (initialized.value) return;
    if (!initializePromise) {
      initializePromise = refresh().finally(() => {
        initializePromise = null;
      });
    }
    return initializePromise;
  }

  async function login(username: string, password: string): Promise<void> {
    setAuthenticated(await apiLogin(username.trim(), password));
  }

  async function setup(token: string, username: string, password: string): Promise<void> {
    setAuthenticated(await apiSetupAdmin(token.trim(), normalizeSetupUsername(username), password));
  }

  async function pair(code: string): Promise<void> {
    setAuthenticated(await apiPair(code.trim()));
  }

  async function logout(): Promise<void> {
    try {
      if (authenticated.value) await apiLogout();
    } finally {
      setAnonymous();
    }
  }

  function expireFromWebSocket(): void {
    if (authenticated.value) setAnonymous('websocket');
  }

  return {
    state,
    user,
    oidc,
    initialized,
    setupRequired,
    authenticated,
    isAdmin,
    lastInvalidation,
    can,
    refresh,
    refreshOidcStatus,
    initialize,
    setup,
    login,
    pair,
    logout,
    expireFromWebSocket,
    startUnauthorizedListener,
    stopUnauthorizedListener,
  };
});
