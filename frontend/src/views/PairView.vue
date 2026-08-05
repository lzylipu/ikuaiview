<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthShell from '@/components/auth/AuthShell.vue';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import { ApiError } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const initialCode = typeof route.query.code === 'string' ? route.query.code : '';
const code = ref(initialCode);
const submitting = ref(false);
const errorMessage = ref('');
const canSubmit = computed(() => code.value.trim().length > 0);

async function submit(): Promise<void> {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    await auth.pair(code.value);
    await router.replace('/');
  } catch (error) {
    errorMessage.value = error instanceof ApiError && error.status === 401
      ? '配对码无效、已使用或已过期'
      : error instanceof Error ? error.message : '配对失败';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthShell title="设备配对" subtitle="输入管理员生成的一次性配对码，在这台设备上创建独立会话。" icon="link">
    <form class="pair-form" @submit.prevent="submit">
      <label for="pair-code">配对码</label>
      <input
        id="pair-code"
        v-model="code"
        class="mono"
        autocomplete="one-time-code"
        spellcheck="false"
        autofocus
      />
      <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
      <button type="submit" :disabled="!canSubmit || submitting">
        <FeatherIcon name="link" :size="16" />
        {{ submitting ? '配对中...' : '完成配对' }}
      </button>
    </form>
    <template #footer>
      管理员可返回 <RouterLink to="/login">密码登录</RouterLink>
    </template>
  </AuthShell>
</template>

<style scoped>
.pair-form { display: grid; gap: 10px; }
label { color: var(--color-text-secondary); font-size: 0.78rem; font-weight: 600; }
input { height: 44px; border: 1px solid var(--color-border); border-radius: var(--border-radius-sm); background: var(--color-bg-input); color: var(--color-text-primary); padding: 0 12px; font-size: 0.82rem; }
button { height: 42px; margin-top: 10px; border: 0; border-radius: var(--border-radius-sm); background: var(--color-accent); color: var(--color-text-inverse); display: flex; align-items: center; justify-content: center; gap: 8px; font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.55; cursor: not-allowed; }
.form-error { color: var(--color-danger); background: var(--color-danger-subtle); padding: 8px 10px; border-radius: var(--border-radius-sm); font-size: 0.78rem; }
</style>
