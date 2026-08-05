<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDashboardStore } from '@/stores/dashboard';
import { useThemeStore } from '@/stores/theme';
import { useAuthStore } from '@/stores/auth';
import LiveIndicator from '@/components/shared/LiveIndicator.vue';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import { authMethodLabel } from '@/utils/authDisplay';

const dashboard = useDashboardStore();
const theme = useThemeStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const themeIcon = computed(() => theme.preference === 'system' ? 'monitor' : theme.mode === 'dark' ? 'moon' : 'sun');
const themeLabel = computed(() => theme.preference === 'system' ? '跟随系统' : theme.mode === 'dark' ? '暗色模式' : '亮色模式');
const displayName = computed(() => auth.user?.display_name || auth.user?.username || '');
const initial = computed(() => displayName.value.slice(0, 1).toUpperCase() || 'U');
const authSource = computed(() => auth.user
  ? authMethodLabel(auth.user.auth_method, auth.user.provider_name)
  : '');

async function logout(): Promise<void> {
  await auth.logout().catch(() => undefined);
  await router.replace('/login');
}
</script>

<template>
  <div class="navbar-inner">
    <div class="navbar-left brand"><span class="brand-mark"><FeatherIcon name="wifi" :size="18" /></span><span>iKuaiView</span></div>
    <div class="navbar-center"><h1>{{ route.meta.title || 'iKuaiView' }}</h1></div>
    <div class="navbar-right">
      <LiveIndicator :connected="dashboard.isLive" />
      <button class="icon-button" type="button" :title="themeLabel" :aria-label="themeLabel" @click="theme.toggle()"><FeatherIcon :name="themeIcon" :size="18" /></button>
      <details class="user-menu">
        <summary :aria-label="`用户菜单：${displayName}`"><span class="avatar">{{ initial }}</span></summary>
        <div class="popover">
          <div class="identity">
            <strong>{{ displayName }}</strong>
            <span v-if="auth.user && auth.user.display_name !== auth.user.username">{{ auth.user.username }}</span>
            <span>{{ auth.isAdmin ? '管理员' : '只读用户' }} · {{ authSource }}</span>
          </div>
          <RouterLink v-if="auth.can('manage_sessions')" to="/sessions"><FeatherIcon name="smartphone" :size="15" />会话与配对</RouterLink>
          <button type="button" @click="logout"><FeatherIcon name="log-out" :size="15" />退出登录</button>
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
.navbar-inner{display:flex;align-items:center;width:100%;height:100%;min-width:0}.brand{align-items:center;gap:8px;font-weight:700}.brand-mark{width:30px;height:30px;display:grid;place-items:center;border-radius:var(--border-radius-sm);background:var(--color-accent-subtle);color:var(--color-accent)}h1{font-size:1.1rem}.icon-button{width:34px;height:34px;border:0;border-radius:var(--border-radius-sm);background:transparent;color:var(--color-text-secondary);display:grid;place-items:center;cursor:pointer}.icon-button:hover{background:var(--color-bg-hover)}.user-menu{position:relative}.user-menu summary{list-style:none;cursor:pointer}.user-menu summary::-webkit-details-marker{display:none}.avatar{width:32px;height:32px;display:grid;place-items:center;border-radius:50%;background:var(--color-accent);color:var(--color-text-inverse);font-size:.82rem;font-weight:700}.popover{position:absolute;z-index:400;top:calc(100% + 10px);right:0;width:220px;padding:6px;border:1px solid var(--color-border);border-radius:var(--border-radius-sm);background:var(--color-bg-card);box-shadow:var(--shadow-elevated)}.identity{display:grid;padding:9px 10px 11px;border-bottom:1px solid var(--color-border-light);margin-bottom:5px;overflow-wrap:anywhere}.identity strong{font-size:.82rem}.identity span{color:var(--color-text-muted);font-size:.7rem}.popover a,.popover button{width:100%;min-height:36px;padding:0 9px;display:flex;align-items:center;gap:8px;border:0;border-radius:var(--border-radius-sm);background:transparent;color:var(--color-text-secondary);font:inherit;font-size:.78rem;cursor:pointer}.popover a:hover,.popover button:hover{background:var(--color-bg-hover);color:var(--color-text-primary)}@media(max-width:640px){.navbar-left{display:none}.navbar-center{justify-content:flex-start;min-width:0}.navbar-center h1{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.navbar-right{gap:8px}}
</style>
