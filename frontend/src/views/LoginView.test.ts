import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import LoginView from './LoginView.vue';
import { useAuthStore } from '@/stores/auth';

const mocks = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(readonly status: number) {
      super(`HTTP ${status}`);
    }
  }
  return {
    ApiError: TestApiError,
    replace: vi.fn(),
    routeQuery: { redirect: '/traffic' } as Record<string, unknown>,
    beginOidcAuthorization: vi.fn(),
    fetchFullConfig: vi.fn(),
    fetchAuthStatus: vi.fn(),
    fetchMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    pair: vi.fn(),
    setupAdmin: vi.fn(),
  };
});

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: mocks.routeQuery }),
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/utils/oidc', () => ({
  beginOidcAuthorization: mocks.beginOidcAuthorization,
}));

vi.mock('@/api', () => ({
  API_UNAUTHORIZED_EVENT: 'ikuaiview:unauthorized',
  ...mocks,
}));

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.replace.mockReset();
    mocks.login.mockReset();
    mocks.beginOidcAuthorization.mockReset();
    mocks.fetchFullConfig.mockReset();
    mocks.routeQuery = { redirect: '/traffic' };
    mocks.fetchAuthStatus.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('navigates after authentication without turning a configuration failure into a login error', async () => {
    mocks.login.mockResolvedValue({
      username: 'admin',
      display_name: 'Local administrator',
      role: 'admin',
      session_kind: 'standard',
      auth_method: 'password',
      provider_name: null,
      capabilities: ['read', 'configure', 'manage_devices', 'manage_sessions'],
    });
    mocks.fetchFullConfig.mockRejectedValue(new Error('configuration unavailable'));
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(LoginView, {
      global: {
        plugins: [pinia],
        stubs: { AuthShell: false, FeatherIcon: true, RouterLink: true },
      },
    });

    await wrapper.get('#login-password').setValue('secret');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.login).toHaveBeenCalledWith('admin', 'secret');
    expect(mocks.fetchFullConfig).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith('/traffic');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('starts available OIDC login with the validated deep link and locks both actions', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().oidc = { provider_name: 'Example Identity Provider', available: true };
    const wrapper = mount(LoginView, {
      global: {
        plugins: [pinia],
        stubs: { AuthShell: false, FeatherIcon: true, RouterLink: true },
      },
    });
    await flushPromises();

    const oidcButton = wrapper.get('button.oidc-button');
    expect(oidcButton.text()).toContain('使用 Example Identity Provider 登录');
    await oidcButton.trigger('click');

    expect(mocks.beginOidcAuthorization).toHaveBeenCalledWith('/traffic');
    expect(oidcButton.text()).toContain('正在跳转');
    expect(wrapper.get('.login-actions').attributes('aria-busy')).toBe('true');
    expect(wrapper.get('button.primary-button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('#login-username').attributes('disabled')).toBeDefined();
    expect(wrapper.get('#login-password').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.password-control button').attributes('disabled')).toBeDefined();
    expect(mocks.fetchAuthStatus).not.toHaveBeenCalled();
  });

  it('polls only while a configured provider is unavailable and stops after recovery', async () => {
    vi.useFakeTimers();
    mocks.fetchAuthStatus
      .mockResolvedValueOnce({
        setup_required: false,
        authenticated: false,
        oidc: { provider_name: 'Unavailable Identity', available: false },
      })
      .mockResolvedValueOnce({
        setup_required: false,
        authenticated: false,
        oidc: { provider_name: 'Unavailable Identity', available: true },
      });
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().oidc = { provider_name: 'Unavailable Identity', available: false };
    const wrapper = mount(LoginView, {
      global: {
        plugins: [pinia],
        stubs: { AuthShell: false, FeatherIcon: true, RouterLink: true },
      },
    });
    await flushPromises();

    expect(wrapper.get('button.oidc-button').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('单点登录暂时不可用');
    expect(mocks.fetchAuthStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.fetchAuthStatus).toHaveBeenCalledTimes(1);
    expect(wrapper.get('button.oidc-button').attributes('disabled')).toBeDefined();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.fetchAuthStatus).toHaveBeenCalledTimes(2);
    expect(wrapper.get('button.oidc-button').attributes('disabled')).toBeUndefined();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.fetchAuthStatus).toHaveBeenCalledTimes(2);
  });
});
