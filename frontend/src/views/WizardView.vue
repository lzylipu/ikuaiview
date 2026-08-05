<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useThemeStore, type ThemePreference } from '@/stores/theme';
import { useViewport } from '@/composables/useViewport';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import {
  updateConfig,
  testConnection,
  fetchFullConfig,
  ApiError,
  type ConnectionTestResult,
} from '@/api';

const router = useRouter();
const themeStore = useThemeStore();
const { isPortrait } = useViewport();

// ── Steps ───────────────────────────────────────────────

const currentStep = ref(1);
const totalSteps = 3;

const stepTitles = ['iKuai 连接', '采集与偏好', '完成配置'];

const pollIntervalInput = ref<HTMLInputElement | null>(null);
const probeIntervalInput = ref<HTMLInputElement | null>(null);
const rawRetentionInput = ref<HTMLInputElement | null>(null);
const totalRetentionInput = ref<HTMLInputElement | null>(null);
const stepHeading = ref<HTMLElement | null>(null);

async function focusCurrentStepHeading(): Promise<void> {
  await nextTick();
  stepHeading.value?.focus();
}

function focusFirstInvalidPreference(): void {
  if (!pollIntervalValid.value) pollIntervalInput.value?.focus();
  else if (!probeIntervalValid.value) probeIntervalInput.value?.focus();
  else if (!rawRetentionValid.value) rawRetentionInput.value?.focus();
  else if (!totalRetentionValid.value) totalRetentionInput.value?.focus();
}

async function nextStep(): Promise<void> {
  if (saving.value) return;
  if (currentStep.value === 1 && !canProceedFromStep1.value) return;
  if (currentStep.value === 2 && !preferencesValid.value) {
    saveError.value = '请修正采集周期和数据保留设置后再继续';
    focusFirstInvalidPreference();
    return;
  }
  saveError.value = null;
  if (currentStep.value < totalSteps) {
    currentStep.value++;
    await focusCurrentStepHeading();
  }
}

async function prevStep(): Promise<void> {
  if (saving.value) return;
  if (currentStep.value > 1) {
    currentStep.value--;
    await focusCurrentStepHeading();
  }
}

// ── Form state ──────────────────────────────────────────

const form = reactive({
  router_host: '192.168.88.1',
  router_port: 443,
  router_scheme: 'https' as 'http' | 'https',
  router_username: 'admin',
  router_password: '',
  accept_invalid_certs: false,
  poll_interval_secs: 3,
  probe_interval_secs: 60,
  db_raw_retention_days: 7,
  db_total_retention_days: 90,
  theme: 'system' as ThemePreference,
});
const allowInsecureRouterHttp = ref(false);
const loadingConfig = ref(true);
const configLoaded = ref(false);
const loadError = ref<string | null>(null);

// ── Connection test ─────────────────────────────────────

const testing = ref(false);
const testResult = ref<ConnectionTestResult | null>(null);
const verifiedFingerprint = ref<string | null>(null);
let testGeneration = 0;
let testController: AbortController | null = null;

function connectionDraft() {
  return {
    router_type: 'ikuai' as const,
    router_host: form.router_host.trim(),
    router_port: form.router_port,
    router_scheme: form.router_scheme,
    router_username: form.router_username.trim(),
    router_password: form.router_password,
    accept_invalid_certs: form.accept_invalid_certs,
  };
}

const connectionFingerprint = computed(() => JSON.stringify(connectionDraft()));
const routerHostBytes = computed(() => new TextEncoder().encode(form.router_host.trim()).byteLength);
const routerUsernameBytes = computed(() =>
  new TextEncoder().encode(form.router_username.trim()).byteLength,
);
const routerPasswordBytes = computed(() =>
  new TextEncoder().encode(form.router_password).byteLength,
);
const connectionFieldsValid = computed(() => {
  const draft = connectionDraft();
  return draft.router_host.length > 0
    && routerHostBytes.value <= 253
    && draft.router_username.length > 0
    && routerUsernameBytes.value <= 128
    && draft.router_password.length > 0
    && routerPasswordBytes.value <= 1024
    && Number.isInteger(draft.router_port)
    && draft.router_port >= 1
    && draft.router_port <= 65_535;
});
const connectionVerified = computed(() =>
  verifiedFingerprint.value === connectionFingerprint.value,
);

watch(connectionFingerprint, () => {
  testGeneration++;
  testController?.abort();
  testController = null;
  testing.value = false;
  testResult.value = null;
  verifiedFingerprint.value = null;
  saveError.value = null;
}, { flush: 'sync' });

async function runConnectionTest() {
  if (saving.value || testing.value) return;
  if (!connectionFieldsValid.value) {
    testResult.value = { success: false, error: '请填写有效的主机、端口和用户名' };
    return;
  }
  testController?.abort();
  const controller = new AbortController();
  testController = controller;
  const generation = ++testGeneration;
  const draft = connectionDraft();
  const fingerprint = JSON.stringify(draft);
  testing.value = true;
  testResult.value = null;
  verifiedFingerprint.value = null;
  try {
    const result = await testConnection(draft, controller.signal);
    if (generation !== testGeneration) return;
    testResult.value = result;
    verifiedFingerprint.value = result.success ? fingerprint : null;
  } catch (error: unknown) {
    if (generation !== testGeneration) return;
    testResult.value = {
      success: false,
      error: error instanceof Error ? error.message : '连接测试失败',
    };
  } finally {
    if (generation === testGeneration) {
      testing.value = false;
      if (testController === controller) testController = null;
    }
  }
}

// ── Password visibility ─────────────────────────────────

const showPassword = ref(false);

function togglePasswordVisibility(): void {
  if (saving.value) return;
  showPassword.value = !showPassword.value;
}

// ── Theme options ───────────────────────────────────────

const themeOptions: { value: ThemePreference; label: string; desc: string; icon: string }[] = [
  { value: 'system', label: '跟随系统', desc: '自动匹配系统亮暗模式', icon: 'monitor' },
  { value: 'dark', label: '暗色', desc: '深色界面，适合低光环境', icon: 'moon' },
  { value: 'light', label: '亮色', desc: '浅色界面，适合明亮环境', icon: 'sun' },
];

function onThemeChange(pref: ThemePreference) {
  if (saving.value) return;
  form.theme = pref;
  themeStore.setPreference(pref);
}

// ── Save & finish ───────────────────────────────────────

const saving = ref(false);
const saveError = ref<string | null>(null);
const pollIntervalValid = computed(() =>
  Number.isInteger(form.poll_interval_secs)
  && form.poll_interval_secs >= 1
  && form.poll_interval_secs <= 30,
);
const probeIntervalValid = computed(() =>
  Number.isInteger(form.probe_interval_secs)
  && form.probe_interval_secs >= 10
  && form.probe_interval_secs <= 600,
);
const rawRetentionValid = computed(() =>
  Number.isInteger(form.db_raw_retention_days)
  && form.db_raw_retention_days >= 1
  && form.db_raw_retention_days <= 30,
);
const totalRetentionValid = computed(() =>
  Number.isInteger(form.db_total_retention_days)
  && form.db_total_retention_days >= 7
  && form.db_total_retention_days <= 365
  && form.db_total_retention_days >= form.db_raw_retention_days,
);
const preferencesValid = computed(() => configLoaded.value
  && pollIntervalValid.value
  && probeIntervalValid.value
  && rawRetentionValid.value
  && totalRetentionValid.value);

async function loadCurrentConfig(): Promise<void> {
  const current = await fetchFullConfig();
  form.router_host = current.router_host;
  form.router_port = current.router_port;
  form.router_scheme = current.router_scheme;
  form.router_username = current.router_username;
  form.router_password = '';
  form.accept_invalid_certs = current.accept_invalid_certs;
  allowInsecureRouterHttp.value = current.allow_insecure_router_http;
  form.poll_interval_secs = current.poll_interval_secs;
  form.probe_interval_secs = current.probe_interval_secs;
  form.db_raw_retention_days = current.db_raw_retention_days;
  form.db_total_retention_days = current.db_total_retention_days;
  if (['system', 'dark', 'light'].includes(current.theme)) {
    form.theme = current.theme as ThemePreference;
    themeStore.setPreference(form.theme);
  }
  verifiedFingerprint.value = null;
  testResult.value = null;
}

async function reloadCurrentConfig(): Promise<boolean> {
  loadingConfig.value = true;
  configLoaded.value = false;
  loadError.value = null;
  saveError.value = null;
  try {
    await loadCurrentConfig();
    configLoaded.value = true;
    return true;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '无法加载当前配置版本';
    return false;
  } finally {
    loadingConfig.value = false;
  }
}

async function finishWizard() {
  if (saving.value) return;
  if (!connectionVerified.value) {
    currentStep.value = 1;
    saveError.value = '连接参数已更改，请重新测试连接';
    await focusCurrentStepHeading();
    return;
  }
  if (!preferencesValid.value) {
    currentStep.value = 2;
    saveError.value = '请修正采集周期和数据保留设置后再继续';
    await focusCurrentStepHeading();
    return;
  }
  saving.value = true;
  saveError.value = null;
  try {
    // Save all config fields + mark wizard as completed
    await updateConfig({
      ...connectionDraft(),
      password_mode: 'replace',
      poll_interval_secs: form.poll_interval_secs,
      probe_interval_secs: form.probe_interval_secs,
      db_raw_retention_days: form.db_raw_retention_days,
      db_total_retention_days: form.db_total_retention_days,
      theme: form.theme,
      wizard_completed: true,
    });
    form.router_password = '';
    await router.replace({ name: 'dashboard' });
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      testGeneration++;
      testController?.abort();
      testController = null;
      testing.value = false;
      verifiedFingerprint.value = null;
      testResult.value = null;
      currentStep.value = 1;
      form.router_password = '';
      if (await reloadCurrentConfig()) {
        saveError.value = '配置已被其他会话修改，表单已重新加载。请重新输入密码并测试连接。';
        await focusCurrentStepHeading();
      } else if (loadError.value) {
        loadError.value = `配置冲突且重新加载失败：${loadError.value}`;
      }
    } else {
      saveError.value = error instanceof Error ? error.message : '保存配置失败';
    }
  } finally {
    saving.value = false;
  }
}

// ── Step 1 validation ───────────────────────────────────

const canProceedFromStep1 = computed(() =>
  configLoaded.value && connectionFieldsValid.value && connectionVerified.value,
);

onMounted(reloadCurrentConfig);

onUnmounted(() => {
  testGeneration++;
  testController?.abort();
  testController = null;
  form.router_password = '';
});
</script>

<template>
  <main class="wizard-view" :class="{ portrait: isPortrait }">
    <div class="wizard-card">
      <!-- Header -->
      <div class="wizard-header">
        <div class="wizard-brand">
          <FeatherIcon name="wifi" :size="28" :stroke-width="1.5" />
          <span class="brand-name">iKuaiView</span>
        </div>
        <h1 class="wizard-title">欢迎使用 iKuaiView</h1>
        <p class="wizard-subtitle">
          在开始之前，请配置 iKuai 连接信息以启用网络监控。
        </p>
      </div>

      <div v-if="loadingConfig" class="config-state" role="status" aria-live="polite">
        <span class="spinner-state" aria-hidden="true" />
        <span>正在加载当前配置...</span>
      </div>

      <div v-else-if="loadError" class="config-state error" role="alert">
        <FeatherIcon name="alert-triangle" :size="20" />
        <span>无法加载当前配置：{{ loadError }}</span>
        <button class="btn-secondary" type="button" @click="reloadCurrentConfig">
          <FeatherIcon name="refresh-cw" :size="14" />
          重试
        </button>
      </div>

      <template v-else>
        <!-- Step indicator -->
        <div class="step-indicator">
          <div
            v-for="step in totalSteps"
            :key="step"
            class="step-dot-row"
          >
            <div
              class="step-dot"
              :class="{
                active: currentStep === step,
                done: currentStep > step,
              }"
            >
              <span v-if="currentStep > step" class="step-check">✓</span>
              <span v-else>{{ step }}</span>
            </div>
            <span
              class="step-label"
              :class="{ active: currentStep === step, done: currentStep > step }"
            >
              {{ stepTitles[step - 1] }}
            </span>
            <div v-if="step < totalSteps" class="step-line" :class="{ done: currentStep > step }" />
          </div>
        </div>

      <div v-if="saveError" class="save-fail" role="alert">
        <FeatherIcon name="alert-triangle" :size="16" />
        <span>{{ saveError }}</span>
      </div>

      <!-- ═══════ Step 1: iKuai Connection ═══════ -->
      <div v-if="currentStep === 1" class="wizard-body">
        <section class="wizard-section">
          <div class="section-header">
            <FeatherIcon name="server" :size="16" />
            <h2 ref="stepHeading" tabindex="-1">iKuai 连接信息</h2>
          </div>

          <div class="field-group">
            <div class="field">
              <label class="field-label" for="wizard-router-host">主机地址</label>
              <input
                id="wizard-router-host"
                v-model="form.router_host"
                class="field-input mono"
                type="text"
                placeholder="192.168.88.1"
                maxlength="253"
                :disabled="saving"
                :aria-invalid="routerHostBytes > 253"
              />
              <span v-if="routerHostBytes > 253" class="field-error" role="alert">
                主机地址不能超过 253 个 UTF-8 字节
              </span>
            </div>

            <div class="field-row">
              <div class="field" style="flex: 1">
                <label class="field-label" for="wizard-router-port">端口</label>
                <input
                  id="wizard-router-port"
                  v-model.number="form.router_port"
                  class="field-input mono short"
                  type="number"
                  min="1"
                  max="65535"
                  step="1"
                  :disabled="saving"
                />
              </div>
              <div class="field" style="flex: 2">
                <label class="field-label" for="wizard-router-scheme">连接方式</label>
                <select
                  id="wizard-router-scheme"
                  v-model="form.router_scheme"
                  class="field-input"
                  :disabled="saving"
                >
                  <option value="https">HTTPS (推荐)</option>
                  <option value="http" :disabled="!allowInsecureRouterHttp">HTTP</option>
                </select>
                <span v-if="!allowInsecureRouterHttp" class="field-hint">
                  部署策略已禁用明文 iKuai HTTP。
                </span>
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="wizard-router-username">用户名</label>
              <input
                id="wizard-router-username"
                v-model="form.router_username"
                class="field-input"
                type="text"
                placeholder="admin"
                maxlength="128"
                :disabled="saving"
                :aria-invalid="routerUsernameBytes > 128"
              />
              <span v-if="routerUsernameBytes > 128" class="field-error" role="alert">
                用户名不能超过 128 个 UTF-8 字节
              </span>
            </div>

            <div class="field">
              <label class="field-label" for="wizard-router-password">密码</label>
              <div class="field-control">
                <input
                  id="wizard-router-password"
                  v-model="form.router_password"
                  class="field-input mono"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="输入 iKuai 密码"
                  :disabled="saving"
                  :aria-invalid="routerPasswordBytes > 1024"
                  :aria-describedby="routerPasswordBytes > 1024 ? 'wizard-router-password-error' : undefined"
                />
                <button
                  type="button"
                  class="toggle-vis-btn"
                  :disabled="saving"
                  @click="togglePasswordVisibility"
                  :title="showPassword ? '隐藏密码' : '显示密码'"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                >
                  <FeatherIcon :name="showPassword ? 'eye-off' : 'eye'" :size="14" />
                </button>
              </div>
              <span
                v-if="routerPasswordBytes > 1024"
                id="wizard-router-password-error"
                class="field-error"
                role="alert"
              >密码不能超过 1024 个 UTF-8 字节</span>
            </div>

            <div class="field checkbox-field">
              <label class="field-label" for="wizard-accept-invalid-certs">允许自签证书</label>
              <div class="field-control">
                <label class="toggle">
                  <input
                    id="wizard-accept-invalid-certs"
                    v-model="form.accept_invalid_certs"
                    type="checkbox"
                    :disabled="saving || form.router_scheme !== 'https'"
                  />
                  <span class="toggle-slider" />
                </label>
                <span class="field-hint-inline">仅 HTTPS 时需要，用于自签名证书</span>
              </div>
            </div>
          </div>

          <!-- Connection test -->
          <div class="test-section">
            <button
              class="btn-test"
              type="button"
              :disabled="saving || testing || !connectionFieldsValid"
              @click="runConnectionTest"
            >
              <span v-if="testing" class="spinner-sm" />
              <FeatherIcon v-else name="zap" :size="14" />
              <span>{{ testing ? '测试中...' : '测试连接' }}</span>
            </button>

            <div
              v-if="testResult"
              class="test-result"
              :class="{ success: testResult.success, fail: !testResult.success }"
              role="status"
              aria-live="polite"
            >
              <template v-if="testResult.success">
                <FeatherIcon name="check-circle" :size="14" />
                <span class="test-result-text">
                  连接成功 — {{ testResult.model || 'iKuai' }} {{ testResult.version || '' }}
                </span>
              </template>
              <template v-else>
                <FeatherIcon name="x-circle" :size="14" />
                <span class="test-result-text">{{ testResult.error || '连接失败' }}</span>
              </template>
            </div>
          </div>
        </section>
      </div>

      <!-- ═══════ Step 2: Preferences ═══════ -->
      <div v-if="currentStep === 2" class="wizard-body">
        <section class="wizard-section">
          <div class="section-header">
            <FeatherIcon name="sliders" :size="16" />
            <h2 ref="stepHeading" tabindex="-1">采集与保留</h2>
          </div>

          <div class="field-group">
            <div class="field">
              <label class="field-label" for="wizard-poll-interval">轮询间隔 (秒)</label>
              <input
                id="wizard-poll-interval"
                ref="pollIntervalInput"
                v-model.number="form.poll_interval_secs"
                class="field-input mono short"
                type="number"
                min="1"
                max="30"
                step="1"
                :disabled="saving"
                :aria-invalid="!pollIntervalValid"
                :aria-describedby="pollIntervalValid ? 'wizard-poll-interval-hint' : 'wizard-poll-interval-hint wizard-poll-interval-error'"
              />
              <span id="wizard-poll-interval-hint" class="field-hint">数据采集频率，1–30 秒。越低越实时但 iKuai 负载更大。</span>
              <span v-if="!pollIntervalValid" id="wizard-poll-interval-error" class="field-error" role="alert">
                请输入 1 到 30 之间的整数
              </span>
            </div>

            <div class="field">
              <label class="field-label" for="wizard-probe-interval">探测间隔 (秒)</label>
              <input
                id="wizard-probe-interval"
                ref="probeIntervalInput"
                v-model.number="form.probe_interval_secs"
                class="field-input mono short"
                type="number"
                min="10"
                max="600"
                step="1"
                :disabled="saving"
                :aria-invalid="!probeIntervalValid"
                :aria-describedby="probeIntervalValid ? 'wizard-probe-interval-hint' : 'wizard-probe-interval-hint wizard-probe-interval-error'"
              />
              <span id="wizard-probe-interval-hint" class="field-hint">网络连通性与延迟探测频率，10–600 秒。</span>
              <span v-if="!probeIntervalValid" id="wizard-probe-interval-error" class="field-error" role="alert">
                请输入 10 到 600 之间的整数
              </span>
            </div>

            <div class="field-row retention-row">
              <div class="field">
                <label class="field-label" for="wizard-raw-retention">原始数据保留 (天)</label>
                <input
                  id="wizard-raw-retention"
                  ref="rawRetentionInput"
                  v-model.number="form.db_raw_retention_days"
                  class="field-input mono short"
                  type="number"
                  min="1"
                  max="30"
                  step="1"
                  :disabled="saving"
                  :aria-invalid="!rawRetentionValid"
                  :aria-describedby="rawRetentionValid ? 'wizard-raw-retention-hint' : 'wizard-raw-retention-hint wizard-raw-retention-error'"
                />
                <span id="wizard-raw-retention-hint" class="field-hint">保留 1–30 天。</span>
                <span v-if="!rawRetentionValid" id="wizard-raw-retention-error" class="field-error" role="alert">
                  请输入 1 到 30 之间的整数
                </span>
              </div>

              <div class="field">
                <label class="field-label" for="wizard-total-retention">聚合数据保留 (天)</label>
                <input
                  id="wizard-total-retention"
                  ref="totalRetentionInput"
                  v-model.number="form.db_total_retention_days"
                  class="field-input mono short"
                  type="number"
                  min="7"
                  max="365"
                  step="1"
                  :disabled="saving"
                  :aria-invalid="!totalRetentionValid"
                  :aria-describedby="totalRetentionValid ? 'wizard-total-retention-hint' : 'wizard-total-retention-hint wizard-total-retention-error'"
                />
                <span id="wizard-total-retention-hint" class="field-hint">保留 7–365 天，且不能短于原始数据。</span>
                <span v-if="!totalRetentionValid" id="wizard-total-retention-error" class="field-error" role="alert">
                  请输入有效天数，且不得短于原始数据保留期
                </span>
              </div>
            </div>
          </div>
        </section>

        <section class="wizard-section">
          <div class="section-header">
            <FeatherIcon name="sun" :size="16" />
            <h2>主题</h2>
          </div>

          <div class="theme-options">
            <label
              v-for="opt in themeOptions"
              :key="opt.value"
              class="theme-option"
              :class="{ active: form.theme === opt.value }"
            >
              <input
                type="radio"
                name="wizard-theme"
                :value="opt.value"
                :checked="form.theme === opt.value"
                :disabled="saving"
                @change="onThemeChange(opt.value)"
              />
              <div class="theme-option-content">
                <div class="theme-option-header">
                  <FeatherIcon :name="opt.icon" :size="16" />
                  <span class="theme-option-label">{{ opt.label }}</span>
                </div>
                <span class="theme-option-desc">{{ opt.desc }}</span>
              </div>
            </label>
          </div>
        </section>
      </div>

      <!-- ═══════ Step 3: Complete ═══════ -->
      <div v-if="currentStep === 3" class="wizard-body">
        <section class="wizard-section">
          <div class="section-header">
            <FeatherIcon name="check-circle" :size="16" />
            <h2 ref="stepHeading" tabindex="-1">配置摘要</h2>
          </div>

          <div class="summary-grid">
            <div class="summary-item">
              <span class="summary-label">iKuai 地址</span>
              <span class="summary-value mono">
                {{ form.router_scheme }}://{{ form.router_host }}:{{ form.router_port }}
              </span>
            </div>
            <div class="summary-item">
              <span class="summary-label">用户名</span>
              <span class="summary-value">{{ form.router_username }}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">密码</span>
              <span class="summary-value">{{ form.router_password ? '已设置' : '未设置' }}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">证书策略</span>
              <span class="summary-value">
                {{ form.accept_invalid_certs ? '允许自签证书' : '要求有效证书' }}
              </span>
            </div>
            <div class="summary-item">
              <span class="summary-label">轮询间隔</span>
              <span class="summary-value">{{ form.poll_interval_secs }} 秒</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">探测间隔</span>
              <span class="summary-value">{{ form.probe_interval_secs }} 秒</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">原始数据保留</span>
              <span class="summary-value">{{ form.db_raw_retention_days }} 天</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">聚合数据保留</span>
              <span class="summary-value">{{ form.db_total_retention_days }} 天</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">主题</span>
              <span class="summary-value">
                {{ themeOptions.find(o => o.value === form.theme)?.label || form.theme }}
              </span>
            </div>
          </div>
        </section>
      </div>

      <!-- ═══════ Footer: navigation buttons ═══════ -->
      <div class="wizard-footer">
        <button
          v-if="currentStep > 1"
          class="btn-secondary"
          type="button"
          :disabled="saving"
          @click="prevStep"
        >
          上一步
        </button>
        <div v-else-if="currentStep === 1" class="footer-spacer" />

        <button
          v-if="currentStep === 1"
          class="btn-primary"
          type="button"
          :disabled="saving || !canProceedFromStep1"
          @click="nextStep"
        >
          下一步
        </button>

        <button
          v-if="currentStep === 2"
          class="btn-primary"
          type="button"
          :disabled="saving"
          @click="nextStep"
        >
          下一步
        </button>

        <button
          v-if="currentStep === 3"
          class="btn-primary"
          type="button"
          :disabled="saving"
          @click="finishWizard"
        >
          <span v-if="saving" class="spinner-sm" />
          <span>{{ saving ? '保存中...' : '完成配置' }}</span>
        </button>
      </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
/* ── Viewport ─────────────────────────────────────────── */

.wizard-view {
  height: 100dvh;
  min-height: 0;
  display: flex;
  align-items: safe center;
  justify-content: center;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: max(24px, env(safe-area-inset-top, 0px)) max(24px, env(safe-area-inset-right, 0px)) max(24px, env(safe-area-inset-bottom, 0px)) max(24px, env(safe-area-inset-left, 0px));
  position: relative;
  background: var(--color-bg-app);
}

.wizard-view.portrait {
  align-items: flex-start;
  padding: max(16px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) max(16px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
}

/* ── Card ─────────────────────────────────────────────── */

.wizard-card {
  position: relative;
  width: 100%;
  min-width: 0;
  max-width: 560px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--card-radius);
  padding: 36px 40px 28px;
}

.portrait .wizard-card {
  padding: 24px 20px 20px;
}

/* ── Header ───────────────────────────────────────────── */

.wizard-header {
  text-align: center;
  margin-bottom: 28px;
}

.wizard-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 16px;
}

.brand-name {
  font-size: 1.1rem;
  font-weight: 700;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--color-text-primary);
}

.wizard-title {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 8px;
}

.wizard-subtitle {
  font-size: 0.82rem;
  color: var(--color-text-muted);
  margin: 0;
  line-height: 1.5;
}

.config-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-secondary);
  font-size: 0.84rem;
  text-align: center;
}

.config-state.error {
  color: var(--color-danger);
}

.config-state .btn-secondary {
  margin-top: 4px;
}

.spinner-state {
  width: 22px;
  height: 22px;
  border: 2px solid var(--color-border-light);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

/* ── Step indicator ───────────────────────────────────── */

.step-indicator {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 0;
  margin-bottom: 28px;
}

.step-dot-row {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.step-dot {
  width: 28px;
  height: 28px;
  aspect-ratio: 1;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 600;
  flex-shrink: 0;
  border: 2px solid var(--color-border-light);
  color: var(--color-text-muted);
  background: var(--color-bg-input);
  transition: all var(--transition-fast);
}

.step-dot.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-subtle);
}

.step-dot.done {
  border-color: var(--color-success);
  color: var(--color-success);
  background: var(--color-success-subtle);
}

.step-check {
  font-size: 0.75rem;
  line-height: 1;
}

.step-label {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  transition: color var(--transition-fast);
}

.step-label.active {
  color: var(--color-accent);
  font-weight: 600;
}

.step-label.done {
  color: var(--color-success);
}

.step-line {
  width: 32px;
  height: 2px;
  background: var(--color-border-light);
  margin: 0 4px;
  flex-shrink: 0;
  border-radius: 1px;
  transition: background var(--transition-fast);
}

.step-line.done {
  background: var(--color-success);
}

.portrait .step-line {
  width: 20px;
}

/* ── Body / Sections ──────────────────────────────────── */

.wizard-body {
  min-height: 220px;
}

.wizard-section {
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: var(--color-text-secondary);
}

.section-header h2 {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

/* ── Field styles (reuse SettingsView patterns) ────────── */

.field-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-row {
  display: flex;
  gap: 12px;
}

.field-row > .field {
  min-width: 0;
}

.retention-row > .field {
  flex: 1;
  min-width: 0;
}

.field-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.field-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.field-input {
  padding: 8px 12px;
  font-size: 0.85rem;
  font-family: var(--font-sans);
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  outline: none;
  transition: border-color var(--transition-fast);
  width: 100%;
  box-sizing: border-box;
}

.field-input.short {
  max-width: 110px;
}

.field-input:focus {
  border-color: var(--color-accent);
}

.field-input[aria-invalid="true"] {
  border-color: var(--color-danger);
}

.field-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.field-hint {
  font-size: 0.68rem;
  color: var(--color-text-muted);
}

.field-hint-inline {
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.field-error {
  font-size: 0.72rem;
  color: var(--color-danger);
}

/* ── Checkbox toggle ──────────────────────────────────── */

.checkbox-field .field-control {
  gap: 10px;
}

.toggle {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  cursor: pointer;
}

.toggle input {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.toggle input:disabled {
  cursor: not-allowed;
}

.toggle input:disabled + .toggle-slider {
  opacity: 0.6;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--color-bg-hover);
  border-radius: 11px;
  transition: background var(--transition-fast);
}

.toggle-slider::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  background: var(--color-text-muted);
  border-radius: 50%;
  transition: all var(--transition-fast);
}

.toggle input:checked + .toggle-slider {
  background: var(--color-accent);
}

.toggle input:checked + .toggle-slider::after {
  left: 21px;
  background: #fff;
}

.toggle input:focus-visible + .toggle-slider {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* ── Password visibility ──────────────────────────────── */

.toggle-vis-btn {
  width: 32px;
  height: 32px;
  aspect-ratio: 1;
  flex-shrink: 0;
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-elevated, var(--color-bg-input));
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.toggle-vis-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.toggle-vis-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── Test connection ──────────────────────────────────── */

.test-section {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.btn-test {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  font-size: 0.85rem;
  font-weight: 500;
  font-family: var(--font-sans);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-elevated, var(--color-bg-input));
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-test:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.btn-test:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.test-result {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: 6px;
  font-size: 0.8rem;
  padding: 6px 10px;
  border-radius: var(--border-radius-sm);
}

.test-result > .feather-icon {
  flex-shrink: 0;
}

.test-result-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.test-result.success {
  color: var(--color-success);
  background: var(--color-success-subtle);
}

.test-result.fail {
  color: var(--color-danger);
  background: var(--color-danger-subtle);
}

/* ── Theme options ────────────────────────────────────── */

.theme-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.theme-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.theme-option:hover {
  background: var(--color-bg-hover);
}

.theme-option:has(input:disabled) {
  opacity: 0.6;
  cursor: not-allowed;
}

.theme-option.active {
  border-color: var(--color-accent-border);
  background: var(--color-accent-subtle);
}

.theme-option input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.theme-option:focus-within {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.theme-option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.theme-option-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.theme-option-label {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.theme-option-desc {
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

/* ── Summary grid ─────────────────────────────────────── */

.summary-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-width: 0;
  gap: 16px;
  padding: 8px 12px;
  background: var(--color-bg-input);
  border-radius: var(--border-radius-sm);
}

.summary-label {
  flex: 0 0 auto;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.summary-value {
  min-width: 0;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
  text-align: right;
}

.save-fail {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  padding: 12px 16px;
  border-radius: var(--border-radius-sm);
  color: var(--color-danger);
  background: var(--color-danger-subtle);
  font-size: 0.85rem;
}

.save-fail span {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* ── Footer ───────────────────────────────────────────── */

.wizard-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border-light);
}

.footer-spacer {
  flex: 1;
}

.btn-secondary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  font-size: 0.85rem;
  font-weight: 500;
  font-family: var(--font-sans);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-elevated, var(--color-bg-input));
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 28px;
  font-size: 0.85rem;
  font-weight: 600;
  font-family: var(--font-sans);
  border: none;
  border-radius: var(--border-radius-sm);
  background: var(--color-accent);
  color: var(--color-text-inverse);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Spinner ──────────────────────────────────────────── */

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.btn-test .spinner-sm {
  border-color: var(--color-border-light);
  border-top-color: var(--color-accent);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.portrait .retention-row {
  flex-direction: column;
}

@media (max-width: 480px) {
  .step-indicator {
    justify-content: stretch;
  }

  .step-dot-row {
    flex: 1 1 0;
    gap: 4px;
  }

  .step-dot-row:last-child {
    flex: 0 0 auto;
  }

  .step-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    clip-path: inset(50%);
  }

  .step-line,
  .portrait .step-line {
    width: auto;
    min-width: 8px;
    flex: 1 1 auto;
    margin: 0 4px;
  }

  .summary-item {
    align-items: flex-start;
  }
}

@media (max-height: 520px) and (min-width: 600px) {
  .wizard-view {
    align-items: flex-start;
    padding-top: max(12px, env(safe-area-inset-top, 0px));
    padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));
  }

  .wizard-card {
    max-width: 680px;
    padding: 16px 24px;
  }

  .wizard-header,
  .step-indicator {
    margin-bottom: 12px;
  }

  .wizard-brand {
    margin-bottom: 4px;
  }

  .wizard-title {
    font-size: 1.1rem;
    margin-bottom: 3px;
  }

  .wizard-subtitle {
    font-size: 0.76rem;
  }

  .wizard-body {
    min-height: 0;
  }

  .wizard-footer {
    margin-top: 12px;
    padding-top: 12px;
  }
}
</style>
