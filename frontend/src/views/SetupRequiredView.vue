<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '@/api';
import AuthShell from '@/components/auth/AuthShell.vue';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import { useAuthStore } from '@/stores/auth';
import { normalizeSetupUsername } from '@/utils/setupUsername';

const auth = useAuthStore();
const router = useRouter();
const setupCommand = 'docker compose exec backend ikuaiview-backend admin setup-token';
const token = ref('');
const username = ref('admin');
const password = ref('');
const passwordConfirmation = ref('');
const showPassword = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const copyMessage = ref('');

const normalizedUsername = computed(() => normalizeSetupUsername(username.value));
const tokenValid = computed(() => /^[A-Za-z0-9_-]{43}$/.test(token.value.trim()));
const usernameValid = computed(() => {
  const value = normalizedUsername.value;
  return value.length >= 3 && value.length <= 64 && /^[a-z0-9._-]+$/.test(value);
});
const passwordBytes = computed(() => new TextEncoder().encode(password.value).byteLength);
const passwordValid = computed(() => passwordBytes.value >= 12 && passwordBytes.value <= 128);
const confirmationValid = computed(() => passwordConfirmation.value === password.value);
const canSubmit = computed(() => tokenValid.value
  && usernameValid.value
  && passwordValid.value
  && confirmationValid.value
  && !submitting.value);

function clearSecrets(): void {
  token.value = '';
  password.value = '';
  passwordConfirmation.value = '';
}

async function copySetupCommand(): Promise<void> {
  copyMessage.value = '';
  try {
    await navigator.clipboard.writeText(setupCommand);
    copyMessage.value = '命令已复制';
  } catch {
    copyMessage.value = '复制失败，请手动选择命令。';
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    await auth.setup(token.value, normalizedUsername.value, password.value);
    clearSecrets();
    await router.replace({ name: 'wizard' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      token.value = '';
      errorMessage.value = '一次性令牌无效或已过期，请重新获取令牌。';
    } else if (error instanceof ApiError && error.status === 409) {
      clearSecrets();
      try {
        await auth.refresh();
        await router.replace({ name: auth.authenticated ? 'wizard' : 'login' });
      } catch (refreshError) {
        errorMessage.value = refreshError instanceof Error
          ? refreshError.message
          : '初始设置状态刷新失败';
      }
    } else if (error instanceof ApiError && error.status === 429) {
      errorMessage.value = '尝试次数过多，请稍后再试。';
    } else {
      errorMessage.value = error instanceof Error ? error.message : '创建管理员失败，请重试。';
    }
  } finally {
    submitting.value = false;
  }
}

onUnmounted(clearSecrets);
</script>

<template>
  <AuthShell
    title="创建首个管理员"
    subtitle="获取 15 分钟有效的一次性令牌，然后在此创建本地管理员。"
    icon="user-plus"
  >
    <div class="token-command">
      <span>在部署主机执行</span>
      <div class="command-row">
        <code>{{ setupCommand }}</code>
        <button
          class="icon-button"
          type="button"
          :disabled="submitting"
          title="复制令牌命令"
          aria-label="复制令牌命令"
          @click="copySetupCommand"
        >
          <FeatherIcon name="copy" :size="16" />
        </button>
      </div>
      <p v-if="copyMessage" class="copy-message" role="status" aria-live="polite">
        {{ copyMessage }}
      </p>
    </div>

    <form class="setup-form" :aria-busy="submitting" @submit.prevent="submit">
      <label for="setup-token">一次性令牌</label>
      <input
        id="setup-token"
        v-model="token"
        class="mono"
        type="password"
        autocomplete="one-time-code"
        autocapitalize="off"
        spellcheck="false"
        :disabled="submitting"
        :aria-invalid="token.length > 0 && !tokenValid"
        aria-describedby="setup-token-hint"
        autofocus
      />
      <span id="setup-token-hint" class="field-hint">令牌包含 43 个字符，获取或轮换后 15 分钟内有效。</span>

      <label for="setup-username">管理员用户名</label>
      <input
        id="setup-username"
        v-model="username"
        autocomplete="username"
        autocapitalize="off"
        spellcheck="false"
        :disabled="submitting"
        :aria-invalid="username.length > 0 && !usernameValid"
        aria-describedby="setup-username-hint"
      />
      <span id="setup-username-hint" class="field-hint">3–64 个小写字母、数字、点、下划线或连字符。</span>

      <label for="setup-password">管理员密码</label>
      <div class="password-control">
        <input
          id="setup-password"
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="new-password"
          :disabled="submitting"
          :aria-invalid="password.length > 0 && !passwordValid"
          aria-describedby="setup-password-hint"
        />
        <button
          type="button"
          :disabled="submitting"
          :aria-label="showPassword ? '隐藏密码' : '显示密码'"
          :title="showPassword ? '隐藏密码' : '显示密码'"
          @click="showPassword = !showPassword"
        >
          <FeatherIcon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
        </button>
      </div>
      <span id="setup-password-hint" class="field-hint">12–128 个 UTF-8 字节。</span>

      <label for="setup-password-confirmation">确认密码</label>
      <input
        id="setup-password-confirmation"
        v-model="passwordConfirmation"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="new-password"
        :disabled="submitting"
        :aria-invalid="passwordConfirmation.length > 0 && !confirmationValid"
        :aria-describedby="passwordConfirmation.length > 0 && !confirmationValid ? 'setup-password-confirmation-hint' : undefined"
      />
      <span
        v-if="passwordConfirmation.length > 0 && !confirmationValid"
        id="setup-password-confirmation-hint"
        class="field-error"
        role="alert"
      >两次输入的密码不一致。</span>

      <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
      <button class="primary-button" type="submit" :disabled="!canSubmit">
        <span v-if="submitting" class="button-spinner" aria-hidden="true" />
        <FeatherIcon v-else name="user-plus" :size="16" />
        {{ submitting ? '正在创建...' : '创建管理员' }}
      </button>
    </form>
  </AuthShell>
</template>

<style scoped>
.token-command { display: grid; gap: 7px; margin-bottom: 20px; color: var(--color-text-secondary); font-size: 0.76rem; }
.command-row { display: grid; grid-template-columns: minmax(0, 1fr) 36px; gap: 6px; align-items: stretch; }
.command-row code { min-width: 0; padding: 9px 10px; border: 1px solid var(--color-border-light); border-radius: var(--border-radius-sm); background: var(--color-bg-input); color: var(--color-text-primary); overflow-wrap: anywhere; line-height: 1.45; }
.icon-button { width: 36px; min-height: 36px; border: 1px solid var(--color-border); border-radius: var(--border-radius-sm); background: var(--color-bg-input); color: var(--color-text-secondary); display: grid; place-items: center; cursor: pointer; }
.copy-message { color: var(--color-accent); font-size: 0.72rem; }
.setup-form { display: grid; gap: 8px; }
label { color: var(--color-text-secondary); font-size: 0.78rem; font-weight: 600; }
input { width: 100%; height: 40px; border: 1px solid var(--color-border); border-radius: var(--border-radius-sm); background: var(--color-bg-input); color: var(--color-text-primary); padding: 0 11px; font: inherit; }
input[aria-invalid="true"] { border-color: var(--color-danger); }
input:focus-visible, button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.mono { font-family: var(--font-mono); }
.field-hint, .field-error { margin-top: -3px; color: var(--color-text-muted); font-size: 0.69rem; line-height: 1.4; }
.field-error { color: var(--color-danger); }
.password-control { position: relative; }
.password-control input { padding-right: 44px; }
.password-control button { position: absolute; right: 3px; top: 3px; width: 34px; height: 34px; border: 0; border-radius: var(--border-radius-sm); background: transparent; color: var(--color-text-secondary); display: grid; place-items: center; cursor: pointer; }
.form-error { color: var(--color-danger); background: var(--color-danger-subtle); padding: 8px 10px; border-radius: var(--border-radius-sm); font-size: 0.76rem; line-height: 1.45; }
.primary-button { width: 100%; height: 42px; margin-top: 10px; border: 0; border-radius: var(--border-radius-sm); background: var(--color-accent); color: var(--color-text-inverse); display: flex; align-items: center; justify-content: center; gap: 8px; font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.55; cursor: not-allowed; }
.button-spinner { width: 15px; height: 15px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-height: 700px) and (min-width: 600px) {
  .token-command { margin-bottom: 12px; }
  .setup-form { gap: 6px; }
  input { height: 36px; }
  .password-control button { width: 30px; height: 30px; }
  .primary-button { height: 38px; margin-top: 6px; }
}
</style>
