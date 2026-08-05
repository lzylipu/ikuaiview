<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthShell from '@/components/auth/AuthShell.vue';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import { ApiError } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { safeInternalRedirect } from '@/utils/internalRedirect';
import { beginOidcAuthorization } from '@/utils/oidc';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const username = ref('admin');
const password = ref('');
const submitting = ref(false);
const oidcStarting = ref(false);
const errorMessage = ref('');
const showPassword = ref(false);
const actionBusy = computed(() => submitting.value || oidcStarting.value);
const canSubmit = computed(() => (
  username.value.trim().length > 0 && password.value.length > 0 && !actionBusy.value
));
const redirect = computed(() => safeInternalRedirect(route.query.redirect));
const oidcProvider = computed(() => auth.oidc);
let oidcRefreshTimer: number | null = null;
let oidcPollingActive = true;

function stopOidcRefresh(): void {
  if (oidcRefreshTimer === null) return;
  window.clearTimeout(oidcRefreshTimer);
  oidcRefreshTimer = null;
}

function syncOidcRefresh(): void {
  if (!oidcPollingActive || !oidcProvider.value || oidcProvider.value.available) {
    stopOidcRefresh();
    return;
  }
  if (oidcRefreshTimer !== null) return;
  oidcRefreshTimer = window.setTimeout(async () => {
    oidcRefreshTimer = null;
    await auth.refreshOidcStatus().catch(() => undefined);
    syncOidcRefresh();
  }, 30_000);
}

function startOidc(): void {
  if (!oidcProvider.value?.available || actionBusy.value) return;
  oidcStarting.value = true;
  errorMessage.value = '';
  try {
    beginOidcAuthorization(redirect.value);
  } catch {
    oidcStarting.value = false;
    errorMessage.value = '无法开始单点登录，请稍后重试';
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    await auth.login(username.value, password.value);
    await router.replace(redirect.value);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) errorMessage.value = '用户名或密码错误';
    else if (error instanceof ApiError && error.status === 429) errorMessage.value = '尝试次数过多，请稍后再试';
    else errorMessage.value = error instanceof Error ? error.message : '登录失败';
  } finally {
    password.value = '';
    submitting.value = false;
  }
}

const stopOidcWatch = watch(oidcProvider, syncOidcRefresh, { immediate: true });

onUnmounted(() => {
  oidcPollingActive = false;
  stopOidcWatch();
  stopOidcRefresh();
});
</script>

<template>
  <AuthShell
    :title="oidcProvider ? '登录' : '管理员登录'"
    :subtitle="oidcProvider ? '使用单点登录或本地管理员凭据继续。' : '使用 iKuaiView 管理员凭据继续。'"
    icon="lock"
  >
    <div class="login-actions" :aria-busy="actionBusy">
      <div v-if="oidcProvider" class="oidc-section">
        <button
          class="oidc-button"
          type="button"
          :disabled="!oidcProvider.available || actionBusy"
          @click="startOidc"
        >
          <span v-if="oidcStarting" class="button-spinner" />
          <FeatherIcon v-else name="log-in" :size="16" />
          <span>{{ oidcStarting ? '正在跳转...' : `使用 ${oidcProvider.provider_name} 登录` }}</span>
        </button>
        <p v-if="!oidcProvider.available" class="provider-unavailable" role="status">
          单点登录暂时不可用，请使用本地管理员凭据。
        </p>
        <div class="auth-divider"><span>本地管理员登录</span></div>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label for="login-username">用户名</label>
        <input id="login-username" v-model="username" autocomplete="username" autofocus :disabled="actionBusy" />

        <label for="login-password">密码</label>
        <div class="password-control">
          <input
            id="login-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            :disabled="actionBusy"
          />
          <button
            type="button"
            :disabled="actionBusy"
            :aria-label="showPassword ? '隐藏密码' : '显示密码'"
            :title="showPassword ? '隐藏密码' : '显示密码'"
            @click="showPassword = !showPassword"
          >
            <FeatherIcon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
          </button>
        </div>

        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <button class="primary-button" type="submit" :disabled="!canSubmit">
          <span v-if="submitting" class="button-spinner" />
          <FeatherIcon v-else name="log-in" :size="16" />
          {{ submitting ? '登录中...' : '登录' }}
        </button>
      </form>
    </div>

    <template #footer>
      固定设备可使用 <RouterLink to="/pair">配对码登录</RouterLink>
    </template>
  </AuthShell>
</template>

<style scoped>
.auth-form { display: grid; gap: 9px; }
.login-actions { display: grid; }
.oidc-section { display: grid; gap: 10px; margin-bottom: 18px; }
.oidc-button {
  width: 100%; min-height: 42px; padding: 9px 12px; border: 1px solid var(--color-accent-border);
  border-radius: var(--border-radius-sm); background: var(--color-accent-subtle); color: var(--color-accent);
  display: flex; align-items: center; justify-content: center; gap: 8px; font: inherit; font-weight: 600;
  line-height: 1.35; overflow-wrap: anywhere; cursor: pointer;
}
.oidc-button:disabled { opacity: 0.55; cursor: not-allowed; }
.provider-unavailable { color: var(--color-text-muted); font-size: 0.74rem; line-height: 1.5; text-align: center; }
.auth-divider { display: flex; align-items: center; gap: 10px; color: var(--color-text-muted); font-size: 0.7rem; }
.auth-divider::before, .auth-divider::after { content: ''; height: 1px; flex: 1; background: var(--color-border-light); }
.auth-divider span { flex: none; }
label { color: var(--color-text-secondary); font-size: 0.78rem; font-weight: 600; }
input {
  width: 100%; height: 42px; border: 1px solid var(--color-border); border-radius: var(--border-radius-sm);
  background: var(--color-bg-input); color: var(--color-text-primary); padding: 0 12px; font: inherit;
}
.password-control { position: relative; }
.password-control input { padding-right: 44px; }
.password-control button {
  position: absolute; right: 4px; top: 4px; width: 34px; height: 34px; display: grid; place-items: center;
  border: 0; border-radius: var(--border-radius-sm); background: transparent; color: var(--color-text-secondary); cursor: pointer;
}
.primary-button {
  height: 42px; margin-top: 12px; border: 0; border-radius: var(--border-radius-sm); background: var(--color-accent);
  color: var(--color-text-inverse); display: flex; align-items: center; justify-content: center; gap: 8px; font: inherit; font-weight: 600; cursor: pointer;
}
.primary-button:disabled { opacity: 0.55; cursor: not-allowed; }
.form-error { color: var(--color-danger); background: var(--color-danger-subtle); padding: 8px 10px; border-radius: var(--border-radius-sm); font-size: 0.78rem; }
.button-spinner { width: 15px; height: 15px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-height: 520px) and (min-width: 600px) {
  .oidc-section { margin-bottom: 8px; gap: 5px; }
  .oidc-button { min-height: 36px; padding-block: 6px; }
  .auth-form { gap: 5px; }
  input { height: 36px; }
  .password-control button { width: 28px; height: 28px; }
  .primary-button { height: 36px; margin-top: 4px; }
}
</style>
