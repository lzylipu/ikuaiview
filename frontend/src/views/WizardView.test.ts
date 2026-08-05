import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';
import type { ConnectionTestResult } from '@/api';
import WizardView from './WizardView.vue';

const mocks = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(readonly status: number) {
      super(`HTTP ${status}`);
    }
  }
  return {
    ApiError: TestApiError,
    replace: vi.fn(),
    testConnection: vi.fn(),
    updateConfig: vi.fn(),
    fetchFullConfig: vi.fn(),
  };
});

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/api', () => ({
  ApiError: mocks.ApiError,
  testConnection: mocks.testConnection,
  updateConfig: mocks.updateConfig,
  fetchFullConfig: mocks.fetchFullConfig,
}));

function configFixture(overrides: Record<string, unknown> = {}) {
  return {
    router_host: '192.168.88.1',
    router_port: 443,
    router_scheme: 'https',
    router_username: 'admin',
    accept_invalid_certs: false,
    allow_insecure_router_http: false,
    poll_interval_secs: 3,
    probe_interval_secs: 60,
    db_raw_retention_days: 7,
    db_total_retention_days: 90,
    theme: 'system',
    ...overrides,
  };
}

function mountView(attachTo?: HTMLElement) {
  return mount(WizardView, {
    attachTo,
    global: {
      plugins: [createPinia()],
      stubs: { FeatherIcon: true },
    },
  });
}

async function verifyConnection(wrapper: ReturnType<typeof mountView>) {
  await wrapper.get('#wizard-router-password').setValue('router-secret');
  await wrapper.get('button.btn-test').trigger('click');
  await flushPromises();
}

async function advanceToSummary(wrapper: ReturnType<typeof mountView>) {
  await verifyConnection(wrapper);
  await wrapper.get('button.btn-primary').trigger('click');
  await wrapper.get('button.btn-primary').trigger('click');
}

describe('WizardView', () => {
  beforeEach(() => {
    mocks.testConnection.mockReset();
    mocks.updateConfig.mockReset();
    mocks.fetchFullConfig.mockReset();
    mocks.replace.mockReset();
    mocks.fetchFullConfig.mockResolvedValue(configFixture());
    mocks.testConnection.mockResolvedValue({ success: true, model: 'RB5009', version: '7.20' });
    mocks.updateConfig.mockResolvedValue({ saved: [], requires_restart: [], revision: 2 });
  });

  it('does not expose a default form until current configuration loads', async () => {
    let resolveConfig!: (value: ReturnType<typeof configFixture>) => void;
    mocks.fetchFullConfig.mockImplementationOnce(() => new Promise(resolve => {
      resolveConfig = resolve;
    }));

    const wrapper = mountView();

    expect(wrapper.text()).toContain('正在加载当前配置');
    expect(wrapper.find('#wizard-router-host').exists()).toBe(false);

    resolveConfig(configFixture());
    await flushPromises();

    expect(wrapper.find('#wizard-router-host').exists()).toBe(true);
    expect(wrapper.find('.config-state').exists()).toBe(false);
  });

  it('shows a retry-only error state when configuration loading fails', async () => {
    mocks.fetchFullConfig
      .mockRejectedValueOnce(new Error('configuration unavailable'))
      .mockResolvedValueOnce(configFixture({ router_host: '10.0.0.1' }));
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('.config-state.error').text()).toContain('configuration unavailable');
    expect(wrapper.find('#wizard-router-host').exists()).toBe(false);

    await wrapper.get('.config-state button').trigger('click');
    await flushPromises();

    expect((wrapper.get('#wizard-router-host').element as HTMLInputElement).value).toBe('10.0.0.1');
    expect(mocks.fetchFullConfig).toHaveBeenCalledTimes(2);
  });

  it('hydrates all preferences and disables HTTP when deployment policy forbids it', async () => {
    mocks.fetchFullConfig.mockResolvedValue(configFixture({
      poll_interval_secs: 8,
      probe_interval_secs: 120,
      db_raw_retention_days: 14,
      db_total_retention_days: 180,
      theme: 'dark',
    }));
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('#wizard-router-scheme option[value="http"]').attributes('disabled'))
      .toBeDefined();
    expect(wrapper.text()).toContain('部署策略已禁用明文 iKuai HTTP');

    await verifyConnection(wrapper);
    await wrapper.get('button.btn-primary').trigger('click');

    expect((wrapper.get('#wizard-poll-interval').element as HTMLInputElement).value).toBe('8');
    expect((wrapper.get('#wizard-probe-interval').element as HTMLInputElement).value).toBe('120');
    expect((wrapper.get('#wizard-raw-retention').element as HTMLInputElement).value).toBe('14');
    expect((wrapper.get('#wizard-total-retention').element as HTMLInputElement).value).toBe('180');
  });

  it('does not accept a successful result for connection fields changed in flight', async () => {
    let resolveFirst!: (result: ConnectionTestResult) => void;
    mocks.testConnection.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    const wrapper = mountView();
    await flushPromises();
    await wrapper.get('#wizard-router-password').setValue('router-secret');

    const nextButton = () => wrapper.get('button.btn-primary');
    expect(nextButton().attributes('disabled')).toBeDefined();

    await wrapper.get('button.btn-test').trigger('click');
    const firstSignal = mocks.testConnection.mock.calls[0][1] as AbortSignal;
    await wrapper.get('#wizard-router-host').setValue('192.168.88.2');
    expect(firstSignal.aborted).toBe(true);
    resolveFirst({ success: true, model: 'RB5009', version: '7.20' });
    await flushPromises();

    expect(wrapper.find('.test-result').exists()).toBe(false);
    expect(nextButton().attributes('disabled')).toBeDefined();

    mocks.testConnection.mockResolvedValueOnce({ success: true, model: 'RB5009' });
    await wrapper.get('button.btn-test').trigger('click');
    await flushPromises();

    expect(wrapper.get('.test-result').classes()).toContain('success');
    expect(nextButton().attributes('disabled')).toBeUndefined();

    await wrapper.get('#wizard-router-username').setValue('operator');
    expect(wrapper.find('.test-result').exists()).toBe(false);
    expect(nextButton().attributes('disabled')).toBeDefined();
  });

  it('renders an unbroken iKuai model in the constrained result text element', async () => {
    const longModel = `RB-${'x'.repeat(512)}`;
    mocks.testConnection.mockResolvedValueOnce({ success: true, model: longModel });
    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('#wizard-router-password').setValue('router-secret');
    await wrapper.get('button.btn-test').trigger('click');
    await flushPromises();

    expect(wrapper.get('.test-result')).toBeTruthy();
    expect(wrapper.get('.test-result-text').text()).toContain(longModel);
  });

  it('enforces iKuai host, username, and UTF-8 password size limits', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('#wizard-router-host').attributes('maxlength')).toBe('253');
    expect(wrapper.get('#wizard-router-username').attributes('maxlength')).toBe('128');
    await wrapper.get('#wizard-router-password').setValue('界'.repeat(342));

    expect(wrapper.get('#wizard-router-password').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('button.btn-test').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('1024 个 UTF-8 字节');
  });

  it('validates collection and retention bounds and saves them atomically', async () => {
    const wrapper = mountView();
    await flushPromises();
    await wrapper.get('#wizard-accept-invalid-certs').setValue(true);
    await verifyConnection(wrapper);
    await wrapper.get('button.btn-primary').trigger('click');

    await wrapper.get('#wizard-probe-interval').setValue('9');
    await wrapper.get('#wizard-raw-retention').setValue('15');
    await wrapper.get('#wizard-total-retention').setValue('14');
    const probeInput = wrapper.get('#wizard-probe-interval');
    const focus = vi.spyOn(probeInput.element as HTMLInputElement, 'focus');
    expect(wrapper.get('button.btn-primary').attributes('aria-disabled')).toBeUndefined();
    expect(wrapper.get('button.btn-primary').attributes('disabled')).toBeUndefined();
    expect(wrapper.findAll('.field-error')).toHaveLength(2);
    expect(probeInput.attributes('aria-describedby')).toContain('wizard-probe-interval-error');
    expect(wrapper.get('#wizard-total-retention').attributes('aria-describedby'))
      .toContain('wizard-total-retention-error');
    await wrapper.get('button.btn-primary').trigger('click');
    expect(focus).toHaveBeenCalledOnce();
    expect(wrapper.find('#wizard-router-host').exists()).toBe(false);

    await wrapper.get('#wizard-probe-interval').setValue('120');
    await wrapper.get('#wizard-total-retention').setValue('180');
    expect(wrapper.get('button.btn-primary').attributes('aria-disabled')).toBeUndefined();
    await wrapper.get('button.btn-primary').trigger('click');

    expect(wrapper.text()).toContain('120 秒');
    expect(wrapper.text()).toContain('15 天');
    expect(wrapper.text()).toContain('180 天');
    expect(wrapper.text()).toContain('证书策略');
    expect(wrapper.text()).toContain('允许自签证书');
    await wrapper.get('button.btn-primary').trigger('click');
    await flushPromises();

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      router_type: 'ikuai',
      router_host: '192.168.88.1',
      router_port: 443,
      router_scheme: 'https',
      router_username: 'admin',
      router_password: 'router-secret',
      accept_invalid_certs: true,
      password_mode: 'replace',
      poll_interval_secs: 3,
      probe_interval_secs: 120,
      db_raw_retention_days: 15,
      db_total_retention_days: 180,
      theme: 'system',
      wizard_completed: true,
    });
    expect(mocks.replace).toHaveBeenCalledWith({ name: 'dashboard' });
  });

  it('moves focus to the active step heading after navigation', async () => {
    const wrapper = mountView(document.body);
    try {
      await flushPromises();
      await verifyConnection(wrapper);
      await wrapper.get('button.btn-primary').trigger('click');
      await nextTick();

      const heading = wrapper.get('.wizard-section h2');
      expect(heading.text()).toBe('采集与保留');
      expect(heading.attributes('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(heading.element);
    } finally {
      wrapper.unmount();
    }
  });

  it('locks every interactive step control while saving', async () => {
    const wrapper = mountView();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      saving: boolean;
      showPassword: boolean;
      currentStep: number;
      form: { theme: string };
      togglePasswordVisibility: () => void;
      runConnectionTest: () => Promise<void>;
      nextStep: () => Promise<void>;
      onThemeChange: (preference: 'dark') => void;
    };

    vm.saving = true;
    await nextTick();
    for (const selector of [
      '#wizard-router-host',
      '#wizard-router-port',
      '#wizard-router-scheme',
      '#wizard-router-username',
      '#wizard-router-password',
      '#wizard-accept-invalid-certs',
      '.toggle-vis-btn',
      '.btn-test',
      '.wizard-footer .btn-primary',
    ]) {
      expect(wrapper.get(selector).attributes('disabled')).toBeDefined();
    }
    vm.togglePasswordVisibility();
    await vm.runConnectionTest();
    await vm.nextStep();
    vm.onThemeChange('dark');
    expect(vm.showPassword).toBe(false);
    expect(vm.currentStep).toBe(1);
    expect(vm.form.theme).toBe('system');
    expect(mocks.testConnection).not.toHaveBeenCalled();

    vm.saving = false;
    await nextTick();
    await verifyConnection(wrapper);
    await wrapper.get('button.btn-primary').trigger('click');
    vm.saving = true;
    await nextTick();

    for (const control of wrapper.findAll(
      '.wizard-body input, .wizard-footer button',
    )) {
      expect(control.attributes('disabled')).toBeDefined();
    }
  });

  it('prevents save re-entry and navigation while an update is pending', async () => {
    let resolveSave!: (value: { saved: string[]; requires_restart: string[]; revision: number }) => void;
    mocks.updateConfig.mockImplementationOnce(() => new Promise(resolve => {
      resolveSave = resolve;
    }));
    const wrapper = mountView();
    await flushPromises();
    await advanceToSummary(wrapper);

    const finish = wrapper.get('.wizard-footer .btn-primary');
    await finish.trigger('click');
    expect(finish.attributes('disabled')).toBeDefined();
    expect(wrapper.get('.wizard-footer .btn-secondary').attributes('disabled')).toBeDefined();
    await finish.trigger('click');
    await wrapper.get('.wizard-footer .btn-secondary').trigger('click');

    expect(mocks.updateConfig).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('配置摘要');

    resolveSave({ saved: [], requires_restart: [], revision: 2 });
    await flushPromises();
  });

  it('reloads the whole form after a save conflict and requires a new connection test', async () => {
    mocks.updateConfig.mockRejectedValueOnce(new mocks.ApiError(409));
    mocks.fetchFullConfig
      .mockResolvedValueOnce(configFixture())
      .mockResolvedValueOnce(configFixture({
        router_host: '10.0.0.1',
        router_port: 8443,
        router_username: 'operator',
        accept_invalid_certs: true,
        allow_insecure_router_http: true,
        poll_interval_secs: 8,
        probe_interval_secs: 120,
        db_raw_retention_days: 14,
        db_total_retention_days: 180,
        theme: 'dark',
      }));
    const wrapper = mountView();
    await flushPromises();
    await verifyConnection(wrapper);
    await wrapper.get('button.btn-primary').trigger('click');
    await wrapper.get('button.btn-primary').trigger('click');
    await wrapper.get('button.btn-primary').trigger('click');
    await flushPromises();

    expect((wrapper.get('#wizard-router-host').element as HTMLInputElement).value).toBe('10.0.0.1');
    expect((wrapper.get('#wizard-router-username').element as HTMLInputElement).value).toBe('operator');
    expect((wrapper.get('#wizard-router-password').element as HTMLInputElement).value).toBe('');
    expect(wrapper.find('.test-result').exists()).toBe(false);
    expect(wrapper.get('button.btn-primary').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.save-fail').text()).toContain('请重新输入密码并测试连接');
  });

  it('clears the iKuai password before a failed conflict reload', async () => {
    mocks.updateConfig.mockRejectedValueOnce(new mocks.ApiError(409));
    mocks.fetchFullConfig
      .mockResolvedValueOnce(configFixture())
      .mockRejectedValueOnce(new Error('reload unavailable'));
    const wrapper = mountView();
    await flushPromises();
    await advanceToSummary(wrapper);

    await wrapper.get('.wizard-footer .btn-primary').trigger('click');
    await flushPromises();

    const vm = wrapper.vm as unknown as { form: { router_password: string } };
    expect(vm.form.router_password).toBe('');
    expect(wrapper.get('.config-state.error').text()).toContain('reload unavailable');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('associates labels with numeric and certificate controls', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('label[for="wizard-router-port"]').exists()).toBe(true);
    expect(wrapper.find('label[for="wizard-accept-invalid-certs"]').exists()).toBe(true);

    await verifyConnection(wrapper);
    await wrapper.get('button.btn-primary').trigger('click');
    for (const id of [
      'wizard-poll-interval',
      'wizard-probe-interval',
      'wizard-raw-retention',
      'wizard-total-retention',
    ]) {
      expect(wrapper.find(`label[for="${id}"]`).exists()).toBe(true);
    }
  });
});
