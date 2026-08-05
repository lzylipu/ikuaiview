<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthShell from '@/components/auth/AuthShell.vue';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import { useAuthStore } from '@/stores/auth';
import { safeInternalRedirect } from '@/utils/internalRedirect';

type OidcErrorCode =
  | 'access_denied'
  | 'invalid_state'
  | 'not_authorized'
  | 'provider_unavailable'
  | 'authentication_failed';

const ERROR_MESSAGES: Record<OidcErrorCode, string> = {
  access_denied: '登录已取消或身份提供方拒绝了访问。',
  invalid_state: '登录请求已失效，请重新开始登录。',
  not_authorized: '此账户没有 iKuaiView 的访问权限。',
  provider_unavailable: '身份提供方暂时不可用，请稍后重试。',
  authentication_failed: '单点登录失败，请重新尝试。',
};

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const phase = ref<'loading' | 'error'>('loading');
const errorMessage = ref('');
const redirect = computed(() => safeInternalRedirect(route.query.redirect));

function callbackErrorMessage(value: unknown): string {
  if (typeof value !== 'string' || !Object.hasOwn(ERROR_MESSAGES, value)) {
    return ERROR_MESSAGES.authentication_failed;
  }
  return ERROR_MESSAGES[value as OidcErrorCode];
}

function showError(message: string): void {
  phase.value = 'error';
  errorMessage.value = message;
}

async function completeLogin(): Promise<void> {
  if (route.query.error !== undefined) {
    showError(callbackErrorMessage(route.query.error));
    return;
  }

  try {
    await auth.refresh();
    if (auth.setupRequired) {
      await router.replace({ name: 'setup-required' });
      return;
    }
    if (!auth.authenticated) {
      showError(ERROR_MESSAGES.authentication_failed);
      return;
    }
    await router.replace(redirect.value);
  } catch {
    showError(ERROR_MESSAGES.authentication_failed);
  }
}

async function retry(): Promise<void> {
  await router.replace({ name: 'login', query: { redirect: redirect.value } });
}

onMounted(completeLogin);
</script>

<template>
  <AuthShell
    :title="phase === 'loading' ? '正在完成登录' : '无法完成登录'"
    :subtitle="phase === 'loading' ? '正在验证登录结果。' : '登录未完成。'"
    :icon="phase === 'loading' ? 'shield' : 'alert-circle'"
  >
    <div v-if="phase === 'loading'" class="completion-status" role="status" aria-live="polite">
      <span class="completion-spinner" />
      <span>正在建立 iKuaiView 会话...</span>
    </div>
    <div v-else class="completion-error">
      <p role="alert">{{ errorMessage }}</p>
      <button class="retry-button" type="button" @click="retry">
        <FeatherIcon name="arrow-left" :size="16" />
        返回登录
      </button>
    </div>
  </AuthShell>
</template>

<style scoped>
.completion-status {
  min-height: 44px; display: flex; align-items: center; justify-content: center; gap: 10px;
  color: var(--color-text-secondary); font-size: 0.82rem;
}
.completion-spinner {
  width: 18px; height: 18px; flex: none; border: 2px solid var(--color-border);
  border-top-color: var(--color-accent); border-radius: 50%; animation: spin 0.8s linear infinite;
}
.retry-button {
  width: 100%; min-height: 42px; border: 0; border-radius: var(--border-radius-sm);
  background: var(--color-accent); color: var(--color-text-inverse); display: flex;
  align-items: center; justify-content: center; gap: 8px; padding: 8px 12px;
  font: inherit; font-weight: 600; cursor: pointer;
}
.completion-error { display: grid; gap: 14px; }
.completion-error p {
  padding: 9px 11px; border-radius: var(--border-radius-sm);
  background: var(--color-danger-subtle); color: var(--color-danger);
  font-size: 0.78rem; line-height: 1.5; overflow-wrap: anywhere;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
