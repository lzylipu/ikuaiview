<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useThemeStore, type ThemePreference } from '@/stores/theme';
import { useDashboardStore } from '@/stores/dashboard';
import { useViewport } from '@/composables/useViewport';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import ProbeTargetEditor from '@/components/settings/ProbeTargetEditor.vue';
import {
  fetchFullConfig,
  fetchHealth,
  updateConfig,
  testConnection,
  ApiError,
  type FullConfig,
  type HealthResponse,
} from '@/api';

const themeStore = useThemeStore();
const dashboardStore = useDashboardStore();
const { ikuaiConnected } = storeToRefs(dashboardStore);
const { isPortrait } = useViewport();

// ── Connection status ─────────────────────────────────────

const health = ref<HealthResponse | null>(null);

async function loadHealth() {
  try {
    health.value = await fetchHealth();
  } catch { /* ignore */ }
}

// ── Config state ──────────────────────────────────────────

const config = ref<FullConfig | null>(null);
const configLoading = ref(true);
const configError = ref<string | null>(null);
const showPassword = ref(false);
const connection = reactive({
  router_host: '',
  router_port: 443,
  router_scheme: 'https' as 'http' | 'https',
  router_username: '',
  router_password: '',
  accept_invalid_certs: false,
});

async function loadConfig(): Promise<boolean> {
  configLoading.value = true;
  configError.value = null;
  try {
    config.value = await fetchFullConfig();
    connection.router_host = config.value.router_host;
    connection.router_port = config.value.router_port;
    connection.router_scheme = config.value.router_scheme;
    connection.router_username = config.value.router_username;
    connection.router_password = '';
    connection.accept_invalid_certs = config.value.accept_invalid_certs;
    return true;
  } catch (error: unknown) {
    configError.value = error instanceof Error ? error.message : '加载配置失败';
    return false;
  } finally {
    configLoading.value = false;
  }
}

// ── Field-level save feedback ─────────────────────────────

const saveStatus = ref<Record<string, 'saving' | 'saved' | 'error'>>({});
let editGeneration = 0;
let debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
let feedbackTimers: Record<string, ReturnType<typeof setTimeout>> = {};
let fieldSaveQueue: Promise<void> = Promise.resolve();

function clearTimers(timers: Record<string, ReturnType<typeof setTimeout>>): void {
  Object.values(timers).forEach(timer => clearTimeout(timer));
}

function cancelPendingEdits(): void {
  editGeneration++;
  clearTimers(debounceTimers);
  clearTimers(feedbackTimers);
  debounceTimers = {};
  feedbackTimers = {};
  saveStatus.value = {};
}

function saveField(key: string, value: unknown, generation = editGeneration): Promise<void> {
  const operation = fieldSaveQueue.then(() => performFieldSave(key, value, generation));
  fieldSaveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function performFieldSave(key: string, value: unknown, generation: number): Promise<void> {
  if (generation !== editGeneration) return;
  configError.value = null;
  saveStatus.value[key] = 'saving';
  try {
    const result = await updateConfig({ [key]: value });
    if (generation !== editGeneration) return;
    if (config.value) config.value.revision = result.revision;
    saveStatus.value[key] = 'saved';
    if (feedbackTimers[key]) clearTimeout(feedbackTimers[key]);
    feedbackTimers[key] = setTimeout(() => {
      if (generation === editGeneration && saveStatus.value[key] === 'saved') {
        delete saveStatus.value[key];
      }
      delete feedbackTimers[key];
    }, 2000);
  } catch (error) {
    if (generation !== editGeneration) return;
    if (error instanceof ApiError && error.status === 409) {
      cancelPendingEdits();
      const reloaded = await loadConfig();
      configError.value = reloaded
        ? '配置已被其他会话修改，已重新加载，请确认后再次保存。'
        : `配置已被其他会话修改，但重新加载失败：${configError.value ?? '未知错误'}`;
    } else {
      saveStatus.value[key] = 'error';
      configError.value = error instanceof Error ? error.message : '配置保存失败';
    }
  }
}

// ── Theme ─────────────────────────────────────────────────

function onThemeChange(pref: ThemePreference) {
  themeStore.setPreference(pref);
  if (config.value) {
    config.value.theme = pref;
    saveField('theme', pref);
  }
}

// ── iKuai connection test ──────────────────────────────

const testing = ref(false);
const testResult = ref<{ success: boolean; model?: string; version?: string; error?: string } | null>(null);
const connectionVerified = ref<string | null>(null);
const savingConnection = ref(false);
const connectionSaved = ref(false);
let connectionTestGeneration = 0;
let connectionTestController: AbortController | null = null;

function connectionPayload() {
  return {
    router_type: 'ikuai' as const,
    router_host: connection.router_host.trim(),
    router_port: connection.router_port,
    router_scheme: connection.router_scheme,
    router_username: connection.router_username.trim(),
    router_password: connection.router_password,
    accept_invalid_certs: connection.accept_invalid_certs,
  };
}

const connectionFingerprint = computed(() => JSON.stringify(connectionPayload()));
const connectionValid = computed(() => {
  const draft = connectionPayload();
  return draft.router_host.length > 0
    && draft.router_username.length > 0
    && draft.router_password.length > 0
    && Number.isInteger(draft.router_port)
    && draft.router_port >= 1
    && draft.router_port <= 65_535;
});

watch(connectionFingerprint, () => {
  connectionTestGeneration++;
  connectionTestController?.abort();
  connectionTestController = null;
  testing.value = false;
  connectionVerified.value = null;
  connectionSaved.value = false;
  testResult.value = null;
});

async function runConnectionTest() {
  if (!connectionValid.value) {
    testResult.value = { success: false, error: '请填写完整连接信息和密码' };
    return;
  }
  connectionTestController?.abort();
  const controller = new AbortController();
  connectionTestController = controller;
  const generation = ++connectionTestGeneration;
  const payload = connectionPayload();
  const fingerprint = JSON.stringify(payload);
  testing.value = true;
  testResult.value = null;
  try {
    const result = await testConnection(payload, controller.signal);
    if (generation !== connectionTestGeneration) return;
    testResult.value = result;
    connectionVerified.value = result.success ? fingerprint : null;
  } catch (error: unknown) {
    if (generation !== connectionTestGeneration) return;
    if (error instanceof DOMException && error.name === 'AbortError') return;
    testResult.value = {
      success: false,
      error: error instanceof Error ? error.message : '连接测试失败',
    };
  } finally {
    if (generation === connectionTestGeneration) {
      testing.value = false;
      if (connectionTestController === controller) connectionTestController = null;
    }
  }
}

async function saveConnection() {
  const payload = connectionPayload();
  const fingerprint = JSON.stringify(payload);
  if (connectionVerified.value !== fingerprint || savingConnection.value) return;
  savingConnection.value = true;
  configError.value = null;
  try {
    const result = await updateConfig({ ...payload, password_mode: 'replace' });
    if (config.value) {
      config.value.revision = result.revision;
      config.value.router_host = payload.router_host;
      config.value.router_port = payload.router_port;
      config.value.router_scheme = payload.router_scheme;
      config.value.router_username = payload.router_username;
      config.value.accept_invalid_certs = payload.accept_invalid_certs;
      config.value.password_set = true;
      config.value.router_configured = true;
    }
    if (connectionFingerprint.value !== fingerprint) return;
    connection.router_password = '';
    connectionVerified.value = null;
    testResult.value = null;
    await nextTick();
    connectionSaved.value = true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      cancelPendingEdits();
      const reloaded = await loadConfig();
      configError.value = reloaded
        ? '配置已被其他会话修改，已重新加载；连接设置未自动重试。'
        : `配置已被其他会话修改，但重新加载失败：${configError.value ?? '未知错误'}`;
    } else {
      configError.value = error instanceof Error ? error.message : '连接设置保存失败';
    }
  } finally {
    savingConnection.value = false;
  }
}

function debounceSave(key: string, value: unknown, ms = 600) {
  if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
  const generation = editGeneration;
  debounceTimers[key] = setTimeout(() => {
    delete debounceTimers[key];
    void saveField(key, value, generation);
  }, ms);
}

// ── Lifecycle ─────────────────────────────────────────────

onMounted(() => {
  loadHealth();
  loadConfig();
});

onUnmounted(() => {
  cancelPendingEdits();
  connectionTestGeneration++;
  connectionTestController?.abort();
  connectionTestController = null;
});
</script>

<template>
  <div class="settings-view">
    <div class="settings-scroll">
      <p v-if="configError" class="settings-error" role="alert">{{ configError }}</p>
      <div class="settings-grid" :class="{ portrait: isPortrait }">
        <div class="settings-col">

      <!-- ═══════ Section 1: Connection Status ═══════ -->
      <section class="settings-section">
        <div class="section-header">
          <FeatherIcon name="activity" :size="16" />
          <h2>连接状态</h2>
        </div>
        <div class="status-grid">
          <div class="status-item">
            <span class="status-label">iKuai</span>
            <span class="status-value">
              <span
                class="status-dot"
                :class="ikuaiConnected ? 'online' : 'offline'"
              />
              {{ ikuaiConnected ? '已连接' : '未连接' }}
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">后端状态</span>
            <span class="status-value mono">{{ health?.status ?? '—' }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">后端版本</span>
            <span class="status-value mono">{{ health?.version ?? '—' }}</span>
          </div>
        </div>
      </section>

      <!-- ═══════ Section 2: Theme ═══════ -->
      <section class="settings-section">
        <div class="section-header">
          <FeatherIcon name="sun" :size="16" />
          <h2>主题</h2>
        </div>
        <div class="theme-options">
          <label
            v-for="opt in [
              { value: 'system' as ThemePreference, label: '跟随系统', desc: '自动匹配系统亮暗模式', icon: 'monitor' },
              { value: 'dark' as ThemePreference, label: '暗色', desc: '深色界面，适合低光环境', icon: 'moon' },
              { value: 'light' as ThemePreference, label: '亮色', desc: '浅色界面，适合明亮环境', icon: 'sun' },
            ]"
            :key="opt.value"
            class="theme-option"
            :class="{ active: themeStore.preference === opt.value }"
          >
            <input
              type="radio"
              name="theme"
              :value="opt.value"
              :checked="themeStore.preference === opt.value"
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
        <span v-if="saveStatus.theme === 'saving'" class="save-badge saving">保存中</span>
        <span v-else-if="saveStatus.theme === 'saved'" class="save-badge">已保存</span>
        <span v-else-if="saveStatus.theme === 'error'" class="save-badge error">主题保存失败</span>
      </section>

      <ProbeTargetEditor />

        </div>
        <div class="settings-col">

      <!-- ═══════ Section 3: iKuai Connection ═══════ -->
      <section class="settings-section">
        <div class="section-header">
          <FeatherIcon name="server" :size="16" />
          <h2>iKuai 连接</h2>
          <span v-if="configLoading" class="section-hint">加载中...</span>
        </div>

        <template v-if="config">
          <div class="field-group">
            <div class="field">
              <label class="field-label" for="settings-router-host">主机地址</label>
              <div class="field-control">
                <input
                  class="field-input mono"
                  id="settings-router-host"
                  type="text"
                  v-model="connection.router_host"
                  :disabled="savingConnection"
                />
              </div>
              <span class="field-hint">连接信息测试通过后统一保存</span>
            </div>

            <div class="field">
              <label class="field-label" for="settings-router-port">端口</label>
              <div class="field-control">
                <input
                  class="field-input mono short"
                  id="settings-router-port"
                  type="number"
                  v-model.number="connection.router_port"
                  :disabled="savingConnection"
                />
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="settings-router-scheme">连接方式</label>
              <div class="field-control">
                <select
                  class="field-input"
                  id="settings-router-scheme"
                  v-model="connection.router_scheme"
                  :disabled="savingConnection"
                >
                  <option value="https">HTTPS (推荐)</option>
                  <option value="http" :disabled="!config.allow_insecure_router_http">HTTP</option>
                </select>
              </div>
              <span v-if="!config.allow_insecure_router_http" class="field-hint">
                部署策略已禁用明文 iKuai HTTP。
              </span>
            </div>

            <div class="field">
              <label class="field-label" for="settings-router-username">用户名</label>
              <div class="field-control">
                <input
                  class="field-input"
                  id="settings-router-username"
                  type="text"
                  v-model="connection.router_username"
                  :disabled="savingConnection"
                  placeholder="admin"
                />
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="settings-router-password">密码</label>
              <div class="field-control">
                <input
                  class="field-input mono"
                  id="settings-router-password"
                  v-model="connection.router_password"
                  :type="showPassword ? 'text' : 'password'"
                  :disabled="savingConnection"
                  placeholder="输入密码以测试并保存"
                />
                <button
                  type="button"
                  class="toggle-vis-btn"
                  @click="showPassword = !showPassword"
                  :title="showPassword ? '隐藏密码' : '显示密码'"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                >
                  <FeatherIcon :name="showPassword ? 'eye-off' : 'eye'" :size="14" />
                </button>
                <span v-if="config.password_set && !connection.router_password" class="save-badge saved-hint">已设置</span>
              </div>
            </div>

            <div class="field checkbox-field">
              <label class="field-label" for="settings-accept-invalid-certs">允许自签证书</label>
              <div class="field-control">
                <label class="toggle">
                  <input
                    id="settings-accept-invalid-certs"
                    type="checkbox"
                    v-model="connection.accept_invalid_certs"
                    :disabled="savingConnection"
                  />
                  <span class="toggle-slider" />
                </label>
              </div>
            </div>
          </div>

          <!-- Connection test -->
          <div class="action-row">
            <button class="btn-secondary" :disabled="testing || savingConnection || !connectionValid" @click="runConnectionTest">
              <span v-if="testing" class="spinner-sm" />
              <span>{{ testing ? '测试中...' : '测试连接' }}</span>
            </button>
            <button
              class="btn-primary"
              :disabled="savingConnection || connectionVerified !== connectionFingerprint"
              @click="saveConnection"
            >
              {{ savingConnection ? '保存中...' : '保存连接' }}
            </button>
            <span v-if="connectionSaved" class="save-badge">已保存</span>
            <div v-if="testResult" class="test-result" :class="{ success: testResult.success, fail: !testResult.success }">
              <template v-if="testResult.success">
                <FeatherIcon name="check-circle" :size="14" />
                <span>连接成功 — {{ testResult.model || 'iKuai' }} {{ testResult.version || '' }}</span>
              </template>
              <template v-else>
                <FeatherIcon name="x-circle" :size="14" />
                <span>{{ testResult.error || '连接失败' }}</span>
              </template>
            </div>
          </div>
        </template>
      </section>

      <!-- ═══════ Section 4: Polling & Retention ═══════ -->
      <section class="settings-section">
        <div class="section-header">
          <FeatherIcon name="clock" :size="16" />
          <h2>轮询与数据保留</h2>
        </div>

        <template v-if="config">
          <div class="field-group">
            <div class="field">
              <label class="field-label" for="settings-poll-interval">主轮询间隔 (秒)</label>
              <div class="field-control">
                <input
                  id="settings-poll-interval"
                  class="field-input mono short"
                  type="number"
                  min="1"
                  max="30"
                  :value="config.poll_interval_secs"
                  @input="(e: any) => { const v = parseInt(e.target.value) || 3; config!.poll_interval_secs = v; debounceSave('poll_interval_secs', v) }"
                />
                <span v-if="saveStatus['poll_interval_secs'] === 'saving'" class="save-badge saving">保存中</span>
                <span v-if="saveStatus['poll_interval_secs'] === 'saved'" class="save-badge">已保存 — 即时生效</span>
                <span v-if="saveStatus['poll_interval_secs'] === 'error'" class="save-badge error">失败</span>
              </div>
              <span class="field-hint">数据采集频率，1–30 秒。越低越实时但 iKuai 负载更大。</span>
            </div>

            <div class="field">
              <label class="field-label" for="settings-probe-interval">延迟探测间隔 (秒)</label>
              <div class="field-control">
                <input
                  id="settings-probe-interval"
                  class="field-input mono short"
                  type="number"
                  min="10"
                  max="600"
                  :value="config.probe_interval_secs"
                  @input="(e: any) => { const v = parseInt(e.target.value) || 60; config!.probe_interval_secs = v; debounceSave('probe_interval_secs', v) }"
                />
                <span v-if="saveStatus['probe_interval_secs'] === 'saving'" class="save-badge saving">保存中</span>
                <span v-if="saveStatus['probe_interval_secs'] === 'saved'" class="save-badge">已保存 — 即时生效</span>
                <span v-if="saveStatus['probe_interval_secs'] === 'error'" class="save-badge error">失败</span>
              </div>
              <span class="field-hint">Ping 探测 ISP / DNS / CDN 的间隔，10–600 秒。</span>
            </div>

            <div class="field">
              <label class="field-label" for="settings-raw-retention">原始数据保留 (天)</label>
              <div class="field-control">
                <input
                  id="settings-raw-retention"
                  class="field-input mono short"
                  type="number"
                  min="1"
                  max="30"
                  :value="config.db_raw_retention_days"
                  @input="(e: any) => { const v = parseInt(e.target.value) || 7; config!.db_raw_retention_days = v; debounceSave('db_raw_retention_days', v) }"
                />
                <span v-if="saveStatus['db_raw_retention_days'] === 'saving'" class="save-badge saving">保存中</span>
                <span v-if="saveStatus['db_raw_retention_days'] === 'saved'" class="save-badge">已保存</span>
                <span v-if="saveStatus['db_raw_retention_days'] === 'error'" class="save-badge error">失败</span>
              </div>
              <span class="field-hint">高精度数据（每 5 秒采样）的保留天数，超期后聚合为分钟级。</span>
            </div>

            <div class="field">
              <label class="field-label" for="settings-total-retention">聚合数据保留 (天)</label>
              <div class="field-control">
                <input
                  id="settings-total-retention"
                  class="field-input mono short"
                  type="number"
                  min="7"
                  max="365"
                  :value="config.db_total_retention_days"
                  @input="(e: any) => { const v = parseInt(e.target.value) || 90; config!.db_total_retention_days = v; debounceSave('db_total_retention_days', v) }"
                />
                <span v-if="saveStatus['db_total_retention_days'] === 'saving'" class="save-badge saving">保存中</span>
                <span v-if="saveStatus['db_total_retention_days'] === 'saved'" class="save-badge">已保存</span>
                <span v-if="saveStatus['db_total_retention_days'] === 'error'" class="save-badge error">失败</span>
              </div>
              <span class="field-hint">所有聚合数据的最大保留天数，超期后自动清理。</span>
            </div>

            <div class="field">
              <label class="field-label" for="settings-latency-good">延迟阈值：优秀 (ms)</label>
              <div class="field-control">
                <input
                  id="settings-latency-good"
                  class="field-input mono short"
                  type="number"
                  min="1"
                  max="500"
                  :value="config.latency_good_ms"
                  @input="(e: any) => { const v = parseInt(e.target.value) || 30; config!.latency_good_ms = v; debounceSave('latency_good_ms', v) }"
                />
                <span v-if="saveStatus['latency_good_ms'] === 'saving'" class="save-badge saving">保存中</span>
                <span v-if="saveStatus['latency_good_ms'] === 'saved'" class="save-badge">已保存 — 即时生效</span>
                <span v-if="saveStatus['latency_good_ms'] === 'error'" class="save-badge error">失败</span>
              </div>
              <span class="field-hint">延迟低于此值显示为"低延迟"（绿色），默认 30ms。</span>
            </div>

            <div class="field">
              <label class="field-label" for="settings-latency-poor">延迟阈值：较差 (ms)</label>
              <div class="field-control">
                <input
                  id="settings-latency-poor"
                  class="field-input mono short"
                  type="number"
                  min="1"
                  max="2000"
                  :value="config.latency_poor_ms"
                  @input="(e: any) => { const v = parseInt(e.target.value) || 100; config!.latency_poor_ms = v; debounceSave('latency_poor_ms', v) }"
                />
                <span v-if="saveStatus['latency_poor_ms'] === 'saving'" class="save-badge saving">保存中</span>
                <span v-if="saveStatus['latency_poor_ms'] === 'saved'" class="save-badge">已保存 — 即时生效</span>
                <span v-if="saveStatus['latency_poor_ms'] === 'error'" class="save-badge error">失败</span>
              </div>
              <span class="field-hint">延迟高于此值显示为"高延迟"（红色），介于两阈值之间为"一般"（橙色）。默认 100ms。</span>
            </div>
          </div>
        </template>
      </section>

        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  min-height: 600px;
  overflow: hidden;
}

.settings-scroll {
  height: 100%;
  overflow-y: auto;
  padding: var(--content-gap);
  padding-bottom: calc(var(--content-gap) + var(--bottom-bar-height, 0px));
}

.settings-error {
  margin-bottom: var(--content-gap);
  padding: 9px 11px;
  border-radius: var(--border-radius-sm);
  background: var(--color-danger-subtle);
  color: var(--color-danger);
  font-size: 0.76rem;
}

/* ── Two-column grid (landscape only) ────────────────── */

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--content-gap);
  align-items: start;
}

.settings-grid.portrait {
  grid-template-columns: 1fr;
}

.settings-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

/* ── Section ─────────────────────────────────────────── */

.settings-section {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--card-radius);
  padding: var(--card-padding);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--color-text-secondary);
}

.section-header h2 {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.section-hint {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  margin-left: auto;
}

.section-hint.error {
  color: var(--color-danger);
}

/* ── Status Grid ─────────────────────────────────────── */

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  background: var(--color-bg-input);
  border-radius: var(--border-radius-sm);
}

.status-label {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.status-value {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.online { background: var(--color-success); }
.status-dot.offline { background: var(--color-danger); }

/* ── Theme Options ────────────────────────────────────── */

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
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.theme-option-desc {
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

/* ── Field Groups ─────────────────────────────────────── */

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
  padding: 7px 12px;
  font-size: 0.85rem;
  font-family: var(--font-sans);
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  outline: none;
  transition: border-color var(--transition-fast);
  flex: 1;
  max-width: 320px;
}

.field-input.short {
  max-width: 100px;
}

.field-input:focus {
  border-color: var(--color-accent);
}

.field-hint {
  font-size: 0.68rem;
  color: var(--color-text-muted);
}

.restart-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-warning, #f59e0b);
}

/* ── Toggle switch ────────────────────────────────────── */

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

/* ── Save badge ───────────────────────────────────────── */

.save-badge {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 100px;
  background: var(--color-success-subtle);
  color: var(--color-success);
  white-space: nowrap;
  flex-shrink: 0;
}

.save-badge.saving {
  background: var(--color-bg-hover);
  color: var(--color-text-muted);
}

.save-badge.error {
  background: var(--color-danger-subtle);
  color: var(--color-danger);
}

.save-badge.saved-hint {
  background: transparent;
  color: var(--color-text-muted);
  font-size: 0.68rem;
}

/* ── Password visibility toggle ─────────────────────── */

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

/* ── Action row ───────────────────────────────────────── */

.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.btn-secondary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
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
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  display: flex;
  align-items: center;
  min-height: 34px;
  padding: 7px 16px;
  border: 1px solid var(--color-accent);
  border-radius: var(--border-radius-sm);
  background: var(--color-accent);
  color: var(--color-text-inverse);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.test-result {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  padding: 6px 10px;
  border-radius: var(--border-radius-sm);
}

.test-result.success {
  color: var(--color-success);
  background: var(--color-success-subtle);
}

.test-result.fail {
  color: var(--color-danger);
  background: var(--color-danger-subtle);
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-border-light);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Responsive ───────────────────────────────────────── */

@media (max-width: 820px), (max-height: 520px) and (pointer: coarse) {
  .status-grid {
    grid-template-columns: 1fr 1fr;
  }
  .settings-scroll {
    padding-bottom: calc(var(--content-gap) + var(--bottom-bar-height, 56px));
  }
}
</style>
