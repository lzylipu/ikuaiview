<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import { ApiError, createPairing, fetchSessions, revokeSession } from '@/api';
import type { AuthSession, PairingResult, UserRole } from '@/api';
import { authMethodLabel } from '@/utils/authDisplay';

const sessions = ref<AuthSession[]>([]);
const loading = ref(true);
const errorMessage = ref('');
const revoking = ref<string | null>(null);
const label = ref('');
const role = ref<UserRole>('viewer');
const password = ref('');
const creating = ref(false);
const pairing = ref<PairingResult | null>(null);
const sessionGroups = computed(() => [
  {
    kind: 'standard',
    title: '浏览器会话',
    empty: '暂无浏览器会话',
    icon: 'monitor',
    sessions: sessions.value.filter(session => session.session_kind === 'standard'),
  },
  {
    kind: 'fixed',
    title: '固定设备',
    empty: '暂无固定设备会话',
    icon: 'smartphone',
    sessions: sessions.value.filter(session => session.session_kind === 'fixed'),
  },
]);
const canCreate = computed(() => label.value.trim().length > 0 && (role.value === 'viewer' || password.value.length > 0));

function formatDate(seconds: number): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(seconds * 1000));
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try { sessions.value = await fetchSessions(); }
  catch (error) { errorMessage.value = error instanceof Error ? error.message : '会话加载失败'; }
  finally { loading.value = false; }
}

async function revoke(id: string): Promise<void> {
  revoking.value = id;
  try { await revokeSession(id); await load(); }
  catch (error) { errorMessage.value = error instanceof Error ? error.message : '撤销失败'; }
  finally { revoking.value = null; }
}

async function generate(): Promise<void> {
  if (!canCreate.value || creating.value) return;
  creating.value = true;
  errorMessage.value = '';
  try {
    pairing.value = await createPairing(label.value.trim(), role.value, role.value === 'admin' ? password.value : undefined);
    password.value = '';
  } catch (error) {
    errorMessage.value = error instanceof ApiError && error.status === 401 ? '本地管理员密码不正确' : error instanceof Error ? error.message : '配对码生成失败';
  } finally { creating.value = false; }
}

async function copyCode(): Promise<void> {
  if (pairing.value) await navigator.clipboard.writeText(pairing.value.code);
}

onMounted(load);
</script>

<template>
  <div class="sessions-page">
    <section class="page-section pairing-section">
      <header><h2>创建固定设备会话</h2><p>配对码一次有效，并在短时间后过期。</p></header>
      <form class="pairing-form" @submit.prevent="generate">
        <div class="field"><label for="pair-label">设备标签</label><input id="pair-label" v-model="label" maxlength="80" placeholder="例如：客厅平板" /></div>
        <fieldset><legend>权限</legend><div class="role-control"><label :class="{ active: role === 'viewer' }"><input v-model="role" type="radio" value="viewer" />只读</label><label :class="{ active: role === 'admin' }"><input v-model="role" type="radio" value="admin" />管理员</label></div></fieldset>
        <div v-if="role === 'admin'" class="field"><label for="pair-password">本地管理员密码</label><input id="pair-password" v-model="password" type="password" autocomplete="current-password" /></div>
        <button class="primary-button" type="submit" :disabled="!canCreate || creating"><FeatherIcon name="plus" :size="15" />{{ creating ? '生成中...' : '生成配对码' }}</button>
      </form>
      <div v-if="pairing" class="pairing-result" role="status"><div><span>配对码</span><code>{{ pairing.code }}</code></div><button type="button" title="复制配对码" aria-label="复制配对码" @click="copyCode"><FeatherIcon name="copy" :size="16" /></button><p>{{ pairing.label }} · {{ pairing.role === 'admin' ? '管理员' : '只读' }} · {{ formatDate(pairing.expires_at) }} 过期</p></div>
    </section>

    <section class="page-section">
      <header class="list-header"><div><h2>活动会话</h2><p>撤销后对应浏览器或设备会在下一次鉴权检查时退出。</p></div><button class="icon-action" type="button" title="刷新" aria-label="刷新" @click="load"><FeatherIcon name="refresh-cw" :size="16" /></button></header>
      <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
      <div v-if="loading" class="empty-state">加载中...</div>
      <div v-else class="session-groups">
        <section v-for="group in sessionGroups" :key="group.kind" class="session-group">
          <h3>{{ group.title }}</h3>
          <div v-if="group.sessions.length === 0" class="empty-state compact">{{ group.empty }}</div>
          <div v-else class="session-list">
            <article v-for="session in group.sessions" :key="session.id">
              <div class="session-icon"><FeatherIcon :name="group.icon" :size="18" /></div>
              <div class="session-main">
                <strong>{{ session.label || (group.kind === 'standard' ? `${session.display_name} 浏览器会话` : '未命名设备') }}</strong>
                <span>{{ session.role === 'admin' ? '管理员' : '只读' }} · {{ authMethodLabel(session.auth_method, session.provider_name) }}</span>
                <span>最近活动 {{ formatDate(session.last_seen_at) }}</span>
                <span>有效期至 {{ formatDate(session.expires_at) }}</span>
              </div>
              <span class="status" :class="{ inactive: !session.active }">{{ session.active ? '有效' : '已失效' }}</span>
              <button v-if="session.active" class="revoke" type="button" :disabled="revoking === session.id" @click="revoke(session.id)">撤销</button>
            </article>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sessions-page{width:min(100%,980px);margin:0 auto;padding:24px;display:grid;gap:28px}.page-section{display:grid;gap:18px}.pairing-section{padding-bottom:28px;border-bottom:1px solid var(--color-border-light)}header h1,header h2{font-size:1.05rem;margin-bottom:3px}header p{color:var(--color-text-muted);font-size:.76rem}.pairing-form{display:grid;grid-template-columns:minmax(180px,1fr) auto minmax(190px,1fr) auto;align-items:end;gap:12px}.field{display:grid;gap:6px}.field label,legend{color:var(--color-text-secondary);font-size:.72rem;font-weight:600}.field input{height:38px;border:1px solid var(--color-border);border-radius:var(--border-radius-sm);background:var(--color-bg-input);color:var(--color-text-primary);padding:0 10px;font:inherit}fieldset{border:0}.role-control{display:flex;margin-top:6px}.role-control label{height:38px;display:flex;align-items:center;padding:0 12px;border:1px solid var(--color-border);color:var(--color-text-secondary);cursor:pointer}.role-control label:first-child{border-radius:var(--border-radius-sm) 0 0 var(--border-radius-sm)}.role-control label:last-child{border-radius:0 var(--border-radius-sm) var(--border-radius-sm) 0}.role-control label.active{color:var(--color-accent);background:var(--color-accent-subtle);border-color:var(--color-accent-border)}.role-control input{position:absolute;opacity:0}.primary-button{height:38px;border:0;border-radius:var(--border-radius-sm);padding:0 15px;background:var(--color-accent);color:var(--color-text-inverse);display:flex;align-items:center;gap:7px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap}.primary-button:disabled{opacity:.55;cursor:not-allowed}.pairing-result{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;padding:14px;border:1px solid var(--color-success);border-radius:var(--border-radius-sm);background:var(--color-success-subtle)}.pairing-result div{display:grid;gap:3px;min-width:0}.pairing-result span,.pairing-result p{color:var(--color-text-secondary);font-size:.72rem}.pairing-result code{overflow-wrap:anywhere}.pairing-result button,.icon-action{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--color-border);border-radius:var(--border-radius-sm);background:transparent;color:var(--color-text-secondary);cursor:pointer}.pairing-result p{grid-column:1/-1}.list-header{display:flex;align-items:center;justify-content:space-between}.session-groups{display:grid;gap:22px}.session-group{display:grid;gap:8px}.session-group h3{font-size:.78rem;color:var(--color-text-secondary)}.session-list{display:grid;border-top:1px solid var(--color-border-light)}article{display:grid;grid-template-columns:38px minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:14px 4px;border-bottom:1px solid var(--color-border-light)}.session-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:var(--border-radius-sm);background:var(--color-bg-secondary);color:var(--color-text-secondary)}.session-main{display:grid;min-width:0}.session-main strong{font-size:.82rem;overflow-wrap:anywhere}.session-main span{color:var(--color-text-muted);font-size:.7rem;overflow-wrap:anywhere}.status{color:var(--color-success);font-size:.72rem}.status.inactive{color:var(--color-text-muted)}.revoke{height:32px;padding:0 11px;border:1px solid var(--color-danger);border-radius:var(--border-radius-sm);background:transparent;color:var(--color-danger);font:inherit;font-size:.74rem;cursor:pointer}.empty-state{min-height:100px;display:grid;place-items:center;color:var(--color-text-muted)}.empty-state.compact{min-height:56px;border-top:1px solid var(--color-border-light);border-bottom:1px solid var(--color-border-light);font-size:.76rem}.error-message{padding:9px 11px;border-radius:var(--border-radius-sm);background:var(--color-danger-subtle);color:var(--color-danger);font-size:.76rem}@media(max-width:760px){.sessions-page{padding:16px}.pairing-form{grid-template-columns:1fr;align-items:stretch}article{grid-template-columns:38px minmax(0,1fr) auto}.revoke{grid-column:2/-1;justify-self:start}}
</style>
