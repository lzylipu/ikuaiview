import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import SettingsView from './SettingsView.vue';
import { useDashboardStore } from '@/stores/dashboard';

const apiMocks = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(readonly status: number) {
      super(`HTTP ${status}`);
    }
  }
  return {
    ApiError: TestApiError,
    fetchFullConfig: vi.fn(),
    fetchHealth: vi.fn(),
    updateConfig: vi.fn(),
    testConnection: vi.fn(),
    fetchProbeTargets: vi.fn(),
    updateProbeTargets: vi.fn(),
    resetProbeTargets: vi.fn(),
  };
});

vi.mock('@/api', () => apiMocks);

function configFixture(overrides: Record<string, unknown> = {}) {
  return {
    router_type: 'ikuai',
    revision: 4,
    router_host: '192.168.88.1',
    router_port: 443,
    router_scheme: 'https',
    router_username: 'admin',
    password_set: true,
    router_configured: true,
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
    ...overrides,
  };
}

describe('SettingsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.fetchFullConfig.mockReset();
    apiMocks.fetchHealth.mockReset();
    apiMocks.updateConfig.mockReset();
    apiMocks.testConnection.mockReset();
    apiMocks.fetchHealth.mockResolvedValue({ status: 'ok', version: '0.2.0' });
    apiMocks.fetchFullConfig.mockResolvedValue(configFixture());
  });

  afterEach(() => vi.useRealTimers());

  it('shows the actual health contract and reacts to router connection changes', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const dashboard = useDashboardStore();
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
        stubs: {
          FeatherIcon: true,
          ProbeTargetEditor: true,
        },
      },
    });
    await flushPromises();

    const statuses = wrapper.findAll('.status-item');
    expect(statuses[0].text()).toContain('未连接');
    expect(statuses[1].text()).toContain('ok');
    expect(statuses[2].text()).toContain('0.2.0');

    dashboard.ikuaiConnected = true;
    await nextTick();

    expect(statuses[0].text()).toContain('已连接');
  });

  it('disables plain HTTP when deployment policy forbids it and enables it when allowed', async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [createPinia()],
        stubs: { FeatherIcon: true, ProbeTargetEditor: true },
      },
    });
    await flushPromises();

    expect(wrapper.get('#settings-router-scheme option[value="http"]').attributes('disabled'))
      .toBeDefined();
    expect(wrapper.text()).toContain('部署策略已禁用明文 iKuai HTTP');
    wrapper.unmount();

    apiMocks.fetchFullConfig.mockResolvedValue(configFixture({ allow_insecure_router_http: true }));
    const allowedWrapper = mount(SettingsView, {
      global: {
        plugins: [createPinia()],
        stubs: { FeatherIcon: true, ProbeTargetEditor: true },
      },
    });
    await flushPromises();

    expect(allowedWrapper.get('#settings-router-scheme option[value="http"]')
      .attributes('disabled')).toBeUndefined();
    expect(allowedWrapper.text()).not.toContain('部署策略已禁用明文 iKuai HTTP');
  });

  it('tests and atomically saves a complete canonical connection draft', async () => {
    apiMocks.testConnection.mockResolvedValue({ success: true, model: 'RB5009' });
    apiMocks.updateConfig.mockResolvedValue({
      saved: ['router_host', 'router_password'], requires_restart: [], revision: 5,
    });
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [createPinia()],
        stubs: { FeatherIcon: true, ProbeTargetEditor: true },
      },
    });
    await flushPromises();

    await wrapper.get('#settings-router-password').setValue('router-secret');
    await wrapper.get('button.btn-secondary').trigger('click');
    await flushPromises();
    await wrapper.get('button.btn-primary').trigger('click');
    await flushPromises();

    expect(apiMocks.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        router_host: '192.168.88.1', router_username: 'admin', router_password: 'router-secret',
      }),
      expect.any(AbortSignal),
    );
    expect(apiMocks.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      router_type: 'ikuai', router_host: '192.168.88.1',
      router_password: 'router-secret', password_mode: 'replace',
    }));
    expect((wrapper.get('#settings-router-password').element as HTMLInputElement).value).toBe('');
  });

  it('freezes connection controls and preserves a newer draft while a save is pending', async () => {
    let resolveSave!: (result: {
      saved: string[];
      requires_restart: string[];
      revision: number;
    }) => void;
    apiMocks.testConnection.mockResolvedValue({ success: true, model: 'RB5009' });
    apiMocks.updateConfig.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [createPinia()],
        stubs: { FeatherIcon: true, ProbeTargetEditor: true },
      },
    });
    await flushPromises();

    await wrapper.get('#settings-router-password').setValue('old-secret');
    await wrapper.get('button.btn-secondary').trigger('click');
    await flushPromises();
    await wrapper.get('button.btn-primary').trigger('click');
    await nextTick();

    for (const selector of [
      '#settings-router-host',
      '#settings-router-port',
      '#settings-router-scheme',
      '#settings-router-username',
      '#settings-router-password',
      '#settings-accept-invalid-certs',
    ]) {
      expect(wrapper.get(selector).attributes('disabled')).toBeDefined();
    }

    // Programmatic edits can still occur while native controls are disabled. A
    // stale response must not clear or mark that newer draft as saved.
    const vm = wrapper.vm as unknown as {
      connection: { router_host: string; router_password: string };
    };
    vm.connection.router_host = '192.168.88.2';
    vm.connection.router_password = 'new-secret';
    await nextTick();
    resolveSave({ saved: ['router_host', 'router_password'], requires_restart: [], revision: 5 });
    await flushPromises();

    expect((wrapper.get('#settings-router-host').element as HTMLInputElement).value)
      .toBe('192.168.88.2');
    expect((wrapper.get('#settings-router-password').element as HTMLInputElement).value)
      .toBe('new-secret');
    expect(wrapper.find('.action-row > .save-badge').exists()).toBe(false);
  });

  it('aborts an in-flight connection test when connection fields change', async () => {
    apiMocks.testConnection.mockImplementation((_draft, signal: AbortSignal) => (
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
    ));
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [createPinia()],
        stubs: { FeatherIcon: true, ProbeTargetEditor: true },
      },
    });
    await flushPromises();

    await wrapper.get('#settings-router-password').setValue('router-secret');
    await wrapper.get('button.btn-secondary').trigger('click');
    const signal = apiMocks.testConnection.mock.calls[0][1] as AbortSignal;
    await wrapper.get('#settings-router-host').setValue('192.168.88.2');
    await flushPromises();

    expect(signal.aborted).toBe(true);
    expect(wrapper.find('.test-result').exists()).toBe(false);
  });

  it('cancels pending field edits when a conflict reloads the form', async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [createPinia()],
        stubs: { FeatherIcon: true, ProbeTargetEditor: true },
      },
    });
    await flushPromises();
    vi.useFakeTimers();
    apiMocks.updateConfig.mockRejectedValueOnce(new apiMocks.ApiError(409));

    await wrapper.get('#settings-poll-interval').setValue('9');
    await wrapper.get('input[name="theme"][value="dark"]').setValue();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(apiMocks.updateConfig).toHaveBeenCalledTimes(1);
    expect(wrapper.get('.settings-error').text()).toContain('已重新加载');
  });

  it('drops stale field saves that were queued before a conflict was observed', async () => {
    let rejectFirst!: (error: Error) => void;
    apiMocks.updateConfig.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectFirst = reject;
    }));
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [createPinia()],
        stubs: { FeatherIcon: true, ProbeTargetEditor: true },
      },
    });
    await flushPromises();
    vi.useFakeTimers();

    await wrapper.get('#settings-poll-interval').setValue('9');
    await wrapper.get('#settings-probe-interval').setValue('90');
    await vi.advanceTimersByTimeAsync(600);
    expect(apiMocks.updateConfig).toHaveBeenCalledTimes(1);

    rejectFirst(new apiMocks.ApiError(409));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(apiMocks.updateConfig).toHaveBeenCalledTimes(1);
    expect(wrapper.get('.settings-error').text()).toContain('已重新加载');
  });

  it('cancels pending field edits when the view unmounts', async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [createPinia()],
        stubs: { FeatherIcon: true, ProbeTargetEditor: true },
      },
    });
    await flushPromises();
    vi.useFakeTimers();

    await wrapper.get('#settings-poll-interval').setValue('9');
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(apiMocks.updateConfig).not.toHaveBeenCalled();
  });

  it('labels numeric and certificate controls and surfaces every field save failure', async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [createPinia()],
        stubs: { FeatherIcon: true, ProbeTargetEditor: true },
      },
    });
    await flushPromises();

    for (const input of wrapper.findAll('input[type="number"], input[type="checkbox"]')) {
      const id = input.attributes('id');
      expect(id).toBeTruthy();
      expect(wrapper.find(`label[for="${id}"]`).exists()).toBe(true);
    }

    vi.useFakeTimers();
    apiMocks.updateConfig.mockRejectedValueOnce(new Error('write denied'));
    await wrapper.get('#settings-probe-interval').setValue('90');
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();

    expect(wrapper.get('.settings-error').text()).toContain('write denied');
    expect(wrapper.find('.save-badge.error').exists()).toBe(true);
  });
});
