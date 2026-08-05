import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SetupRequiredView from './SetupRequiredView.vue';
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
    setupAdmin: vi.fn(),
    fetchAuthStatus: vi.fn(),
    fetchMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    pair: vi.fn(),
  };
});

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/api', () => ({
  API_UNAUTHORIZED_EVENT: 'ikuaiview:unauthorized',
  ...mocks,
}));

const admin = {
  username: 'admin',
  display_name: 'Local administrator',
  role: 'admin' as const,
  session_kind: 'standard',
  auth_method: 'password' as const,
  provider_name: null,
  capabilities: ['read', 'configure', 'manage_devices', 'manage_sessions'] as const,
};

function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(SetupRequiredView, {
    global: {
      plugins: [pinia],
      stubs: { AuthShell: false, FeatherIcon: true },
    },
  });
}

async function fillValidForm(wrapper: ReturnType<typeof mountView>) {
  await wrapper.get('#setup-token').setValue('a'.repeat(43));
  await wrapper.get('#setup-username').setValue(' Admin ');
  await wrapper.get('#setup-password').setValue('correct-horse-battery');
  await wrapper.get('#setup-password-confirmation').setValue('correct-horse-battery');
}

describe('SetupRequiredView', () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.setupAdmin.mockReset();
    mocks.fetchAuthStatus.mockReset();
    mocks.fetchMe.mockReset();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('shows and copies the online Compose token command', async () => {
    const wrapper = mountView();
    const command = 'docker compose exec backend ikuaiview-backend admin setup-token';

    expect(wrapper.text()).toContain(command);
    await wrapper.get('button[aria-label="复制令牌命令"]').trigger('click');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(command);
    expect(wrapper.text()).toContain('命令已复制');
  });

  it('validates UTF-8 password bytes and matching confirmation before submitting', async () => {
    const wrapper = mountView();
    await wrapper.get('#setup-token').setValue('a'.repeat(43));
    await wrapper.get('#setup-password').setValue('密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码');
    await wrapper.get('#setup-password-confirmation').setValue('不相同');

    expect(wrapper.get('#setup-password').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('#setup-password-confirmation').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('button.primary-button').attributes('disabled')).toBeDefined();
    expect(mocks.setupAdmin).not.toHaveBeenCalled();
  });

  it('rejects non-ASCII usernames instead of Unicode case-folding them', async () => {
    const wrapper = mountView();
    await wrapper.get('#setup-token').setValue('a'.repeat(43));
    await wrapper.get('#setup-username').setValue('Kaa');
    await wrapper.get('#setup-password').setValue('correct-horse-battery');
    await wrapper.get('#setup-password-confirmation').setValue('correct-horse-battery');

    expect(wrapper.get('#setup-username').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('button.primary-button').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(mocks.setupAdmin).not.toHaveBeenCalled();
  });

  it('creates an authenticated administrator once and immediately replaces the route', async () => {
    let resolveSetup!: (value: typeof admin) => void;
    mocks.setupAdmin.mockImplementation(() => new Promise(resolve => { resolveSetup = resolve; }));
    const wrapper = mountView();
    await fillValidForm(wrapper);

    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('form').attributes('aria-busy')).toBe('true');
    expect(wrapper.get('#setup-token').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button.primary-button').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(mocks.setupAdmin).toHaveBeenCalledOnce();

    resolveSetup(admin);
    await flushPromises();

    expect(mocks.setupAdmin).toHaveBeenCalledWith(
      'a'.repeat(43),
      'admin',
      'correct-horse-battery',
    );
    expect(useAuthStore().authenticated).toBe(true);
    expect(mocks.replace).toHaveBeenCalledWith({ name: 'wizard' });
    expect((wrapper.get('#setup-token').element as HTMLInputElement).value).toBe('');
    expect((wrapper.get('#setup-password').element as HTMLInputElement).value).toBe('');
  });

  it('reports an invalid token without losing passwords needed for a new token', async () => {
    mocks.setupAdmin.mockRejectedValue(new mocks.ApiError(401));
    const wrapper = mountView();
    await fillValidForm(wrapper);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('令牌无效或已过期');
    expect((wrapper.get('#setup-token').element as HTMLInputElement).value).toBe('');
    expect((wrapper.get('#setup-password').element as HTMLInputElement).value)
      .toBe('correct-horse-battery');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('refreshes after a setup conflict and routes an anonymous browser to login', async () => {
    mocks.setupAdmin.mockRejectedValue(new mocks.ApiError(409));
    mocks.fetchAuthStatus.mockResolvedValue({
      setup_required: false,
      authenticated: false,
      oidc: null,
    });
    const wrapper = mountView();
    await fillValidForm(wrapper);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.fetchAuthStatus).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith({ name: 'login' });
    expect((wrapper.get('#setup-password').element as HTMLInputElement).value).toBe('');
  });

  it('refreshes after a setup conflict and routes an authenticated browser to the wizard', async () => {
    mocks.setupAdmin.mockRejectedValue(new mocks.ApiError(409));
    mocks.fetchAuthStatus.mockResolvedValue({
      setup_required: false,
      authenticated: true,
      oidc: null,
    });
    mocks.fetchMe.mockResolvedValue(admin);
    const wrapper = mountView();
    await fillValidForm(wrapper);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.fetchMe).toHaveBeenCalledOnce();
    expect(useAuthStore().authenticated).toBe(true);
    expect(mocks.replace).toHaveBeenCalledWith({ name: 'wizard' });
  });

  it('surfaces setup backoff while preserving inputs for a later retry', async () => {
    mocks.setupAdmin.mockRejectedValue(new mocks.ApiError(429));
    const wrapper = mountView();
    await fillValidForm(wrapper);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('尝试次数过多');
    expect((wrapper.get('#setup-token').element as HTMLInputElement).value).toBe('a'.repeat(43));
    expect((wrapper.get('#setup-password').element as HTMLInputElement).value)
      .toBe('correct-horse-battery');
  });

  it('surfaces server failures while preserving inputs for a safe retry', async () => {
    mocks.setupAdmin.mockRejectedValue(new mocks.ApiError(503));
    const wrapper = mountView();
    await fillValidForm(wrapper);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('HTTP 503');
    expect((wrapper.get('#setup-token').element as HTMLInputElement).value).toBe('a'.repeat(43));
    expect((wrapper.get('#setup-password').element as HTMLInputElement).value)
      .toBe('correct-horse-battery');
  });

  it('keeps secrets for a safe retry after a network failure and clears them on unmount', async () => {
    mocks.setupAdmin.mockRejectedValue(new TypeError('Network unavailable'));
    const wrapper = mountView();
    await fillValidForm(wrapper);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect((wrapper.get('#setup-token').element as HTMLInputElement).value).toBe('a'.repeat(43));
    expect((wrapper.get('#setup-password').element as HTMLInputElement).value)
      .toBe('correct-horse-battery');

    const vm = wrapper.vm as unknown as { token: string; password: string };
    wrapper.unmount();
    expect(vm.token).toBe('');
    expect(vm.password).toBe('');
  });
});
