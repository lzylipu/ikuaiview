import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import OidcCompleteView from './OidcCompleteView.vue';

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  replace: vi.fn(),
  fetchAuthStatus: vi.fn(),
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  pair: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: mocks.query }),
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/api', () => ({
  API_UNAUTHORIZED_EVENT: 'ikuaiview:unauthorized',
  fetchAuthStatus: mocks.fetchAuthStatus,
  fetchMe: mocks.fetchMe,
  login: mocks.login,
  logout: mocks.logout,
  pair: mocks.pair,
  setupAdmin: vi.fn(),
}));

function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(OidcCompleteView, {
    global: { plugins: [pinia], stubs: { FeatherIcon: true } },
  });
}

describe('OidcCompleteView', () => {
  beforeEach(() => {
    mocks.query = { redirect: '/traffic?wan=ether1' };
    mocks.fetchAuthStatus.mockResolvedValue({
      setup_required: false,
      authenticated: true,
      oidc: { provider_name: 'Example Identity', available: true },
    });
    mocks.fetchMe.mockResolvedValue({
      username: 'alice@example.test',
      display_name: 'Alice Example',
      role: 'admin',
      session_kind: 'standard',
      auth_method: 'oidc',
      provider_name: 'Example Identity',
      capabilities: ['read', 'manage_sessions'],
    });
  });

  it('refreshes status and identity before restoring the deep link', async () => {
    mountView();
    await flushPromises();

    expect(mocks.fetchAuthStatus).toHaveBeenCalledOnce();
    expect(mocks.fetchMe).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/traffic?wan=ether1');
  });

  it('falls back to the dashboard instead of redirecting back into completion', async () => {
    mocks.query = { redirect: '/login/oidc/complete?redirect=/traffic' };
    mountView();
    await flushPromises();

    expect(mocks.fetchAuthStatus).toHaveBeenCalledOnce();
    expect(mocks.fetchMe).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  it('shows a fixed cancellation message without contacting protected APIs', async () => {
    mocks.query = { error: 'access_denied', redirect: '/devices' };
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.text()).toContain('登录已取消或身份提供方拒绝了访问');
    expect(mocks.fetchAuthStatus).not.toHaveBeenCalled();
    expect(mocks.fetchMe).not.toHaveBeenCalled();

    await wrapper.get('button.retry-button').trigger('click');
    expect(mocks.replace).toHaveBeenCalledWith({
      name: 'login',
      query: { redirect: '/devices' },
    });
  });

  it('routes an installation requiring setup to the setup instructions', async () => {
    mocks.fetchAuthStatus.mockResolvedValue({
      setup_required: true,
      authenticated: false,
      oidc: { provider_name: 'Example Identity', available: true },
    });
    mountView();
    await flushPromises();

    expect(mocks.fetchMe).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith({ name: 'setup-required' });
  });

  it('uses generic text and a safe fallback for unknown or repeated callback values', async () => {
    mocks.query = {
      error: ['provider response', 'access_denied'],
      redirect: '//outside.example',
    };
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.text()).toContain('单点登录失败，请重新尝试');
    expect(wrapper.text()).not.toContain('provider response');
    await wrapper.get('button.retry-button').trigger('click');
    expect(mocks.replace).toHaveBeenCalledWith({ name: 'login', query: { redirect: '/' } });
  });

  it('does not accept inherited object properties as callback error codes', async () => {
    mocks.query = { error: 'toString', redirect: '/devices' };
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.text()).toContain('单点登录失败，请重新尝试');
    expect(wrapper.text()).not.toContain('[native code]');
    expect(mocks.fetchAuthStatus).not.toHaveBeenCalled();
    expect(mocks.fetchMe).not.toHaveBeenCalled();
  });
});
