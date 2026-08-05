import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TopNavbar from './TopNavbar.vue';
import { useAuthStore } from '@/stores/auth';

vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { title: '网络概况' } }),
  useRouter: () => ({ replace: vi.fn() }),
}));

describe('TopNavbar', () => {
  it('shows the external display name, username, role, and provider', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const auth = useAuthStore();
    auth.state = 'authenticated';
    auth.user = {
      username: 'alice@example.test',
      display_name: 'Alice Example With A Long Display Name',
      role: 'admin',
      session_kind: 'standard',
      auth_method: 'oidc',
      provider_name: 'Example Corporate Identity Provider',
      capabilities: ['read', 'manage_sessions'],
    };

    const wrapper = mount(TopNavbar, {
      global: {
        plugins: [pinia],
        stubs: { FeatherIcon: true, LiveIndicator: true, RouterLink: true },
      },
    });

    expect(wrapper.get('.avatar').text()).toBe('A');
    expect(wrapper.get('.identity').text()).toContain('Alice Example With A Long Display Name');
    expect(wrapper.get('.identity').text()).toContain('alice@example.test');
    expect(wrapper.get('.identity').text()).toContain('管理员 · Example Corporate Identity Provider 单点登录');
  });
});
