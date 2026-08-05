<script setup lang="ts">
import { nextTick, ref, onMounted } from 'vue';
import {
  fetchProbeTargets,
  updateProbeTargets,
  resetProbeTargets,
  type ProbeTarget,
} from '@/api';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';

const CATEGORIES = ['dns', 'cloud', 'cdn', 'repo', 'isp', 'custom'] as const;
const MAX_TARGETS = 32;

const targets = ref<ProbeTarget[]>([]);
const loading = ref(true);
const saving = ref(false);
const saveStatus = ref<'saved' | 'error' | null>(null);
const targetKeys = new WeakMap<ProbeTarget, string>();
let nextTargetKey = 0;

// ── Ordering ─────────────────────────────────────────────────

function targetKey(target: ProbeTarget): string {
  let key = targetKeys.get(target);
  if (!key) {
    key = `probe-${nextTargetKey++}`;
    targetKeys.set(target, key);
  }
  return key;
}

function categoryNeighborIndex(i: number, direction: -1 | 1): number | null {
  const category = targets.value[i]?.category;
  if (!category) return null;
  for (
    let candidate = i + direction;
    candidate >= 0 && candidate < targets.value.length;
    candidate += direction
  ) {
    if (targets.value[candidate]?.category === category) return candidate;
  }
  return null;
}

async function moveTarget(i: number, direction: -1 | 1, event?: Event) {
  const destination = categoryNeighborIndex(i, direction);
  if (destination === null) return;
  const control = event?.currentTarget;
  const item = targets.value.splice(i, 1)[0];
  targets.value.splice(destination, 0, item);
  await nextTick();
  if (control instanceof HTMLElement) {
    const focusTarget = control.matches(':disabled')
      ? control.parentElement?.querySelector<HTMLElement>('.order-btn:not(:disabled)')
      : control;
    focusTarget?.focus();
  }
}

// ── CRUD ───────────────────────────────────────────────────────

async function load() {
  loading.value = true;
  try {
    const res = await fetchProbeTargets();
    targets.value = res.targets.map((t) => ({ ...t }));
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
}

function addTarget() {
  if (targets.value.length >= MAX_TARGETS) return;
  targets.value.push({
    name: '',
    host: '',
    category: 'custom',
    sort_order: targets.value.length,
  });
}

function removeTarget(index: number) {
  targets.value.splice(index, 1);
}

async function save() {
  saving.value = true;
  saveStatus.value = null;
  try {
    // Assign sort_order = index so ordering is preserved
    const payload = targets.value.map((t, i) => ({ ...t, sort_order: i }));
    const res = await updateProbeTargets(payload);
    targets.value = res.targets.map((t) => ({ ...t }));
    saveStatus.value = 'saved';
    setTimeout(() => {
      if (saveStatus.value === 'saved') saveStatus.value = null;
    }, 2000);
  } catch {
    saveStatus.value = 'error';
  } finally {
    saving.value = false;
  }
}

async function reset() {
  saving.value = true;
  saveStatus.value = null;
  try {
    const res = await resetProbeTargets();
    targets.value = res.targets.map((t) => ({ ...t }));
    saveStatus.value = 'saved';
    setTimeout(() => {
      if (saveStatus.value === 'saved') saveStatus.value = null;
    }, 2000);
  } catch {
    saveStatus.value = 'error';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="settings-section">
    <div class="section-header">
      <FeatherIcon name="zap" :size="16" />
      <h2>探测站点</h2>
      <span v-if="loading" class="section-hint">加载中...</span>
      <button
        v-else
        type="button"
        class="btn-reset"
        :disabled="saving"
        @click="reset"
      >
        重置为默认
      </button>
    </div>

    <div v-if="!loading" class="probe-table-wrap">
      <table class="probe-table">
        <thead>
          <tr>
            <th class="col-grip" scope="col"><span class="visually-hidden">排序</span></th>
            <th class="col-name" scope="col">名称</th>
            <th class="col-host" scope="col">目标地址</th>
            <th class="col-cat" scope="col">类别</th>
            <th class="col-del" scope="col"><span class="visually-hidden">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
              v-for="(t, i) in targets"
              :key="targetKey(t)"
              class="probe-row"
            >
            <td class="col-grip">
              <div class="order-controls">
                <button
                  type="button"
                  class="order-btn"
                  :disabled="categoryNeighborIndex(i, -1) === null"
                  :aria-label="`上移 ${t.name || `站点 ${i + 1}`}`"
                  title="上移"
                  @click="moveTarget(i, -1, $event)"
                >
                  <FeatherIcon name="chevron-up" :size="13" />
                </button>
                <button
                  type="button"
                  class="order-btn"
                  :disabled="categoryNeighborIndex(i, 1) === null"
                  :aria-label="`下移 ${t.name || `站点 ${i + 1}`}`"
                  title="下移"
                  @click="moveTarget(i, 1, $event)"
                >
                  <FeatherIcon name="chevron-down" :size="13" />
                </button>
              </div>
            </td>
            <td class="col-name">
              <input
                class="field-input"
                type="text"
                v-model="t.name"
                maxlength="64"
                :aria-label="`站点 ${i + 1} 名称`"
                placeholder="名称"
              />
            </td>
            <td class="col-host">
              <input
                class="field-input mono"
                type="text"
                v-model="t.host"
                maxlength="253"
                :aria-label="`${t.name || `站点 ${i + 1}`} 目标地址`"
                placeholder="IP 或域名"
              />
            </td>
            <td class="col-cat">
              <select
                v-model="t.category"
                class="field-input"
                :aria-label="`${t.name || `站点 ${i + 1}`} 类别`"
              >
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </td>
            <td class="col-del">
              <button
                type="button"
                class="btn-del"
                title="删除"
                :aria-label="`删除 ${t.name || `站点 ${i + 1}`}`"
                @click="removeTarget(i)"
              >
                <FeatherIcon name="trash-2" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="targets.length === 0" class="empty-hint">
        暂无探测站点，点击"添加站点"或"重置为默认"
      </div>
    </div>

    <!-- Actions -->
    <div class="probe-actions">
      <button
        type="button"
        class="btn-add"
        :disabled="saving || targets.length >= MAX_TARGETS"
        @click="addTarget"
      >
        <FeatherIcon name="plus" :size="14" />
        <span>添加站点</span>
      </button>

      <div class="probe-actions-right">
        <span v-if="saveStatus === 'saved'" class="save-badge">已保存 — 即时生效</span>
        <span v-if="saveStatus === 'error'" class="save-badge error">保存失败</span>
        <button
          type="button"
          class="btn-save"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? '保存中...' : '保存更改' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Re-use section styles from SettingsView */
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
  flex: 1;
}

.section-hint {
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.btn-reset {
  font-size: 0.72rem;
  padding: 2px 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-reset:hover:not(:disabled) {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.btn-reset:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Table ─────────────────────────────────────────── */

.probe-table-wrap {
  overflow-x: auto;
}

.probe-table {
  width: 100%;
  border-collapse: collapse;
}

.probe-table th {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 6px 4px;
  border-bottom: 1px solid var(--color-border-light);
  text-align: left;
}

.probe-table td {
  padding: 4px;
  border-bottom: 1px solid var(--color-border-light);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.col-grip { width: 56px; text-align: center; }
.col-name { width: 28%; }
.col-host { width: 32%; }
.col-cat { width: 18%; }
.col-del { width: 12%; text-align: center; }

/* ── Ordering controls ────────────────────────────────────── */

.order-controls {
  display: inline-flex;
  gap: 2px;
}

.order-btn {
  width: 24px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--color-border-light);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.order-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-subtle);
}

.order-btn:disabled {
  color: var(--color-text-muted);
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── Field inputs (match SettingsView) ──────────────── */

.field-input {
  width: 100%;
  padding: 5px 8px;
  font-size: 0.82rem;
  font-family: var(--font-sans);
  border: 1px solid var(--color-border-light);
  border-radius: 4px;
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  outline: none;
  transition: border-color var(--transition-fast);
  box-sizing: border-box;
}

.field-input.mono {
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.field-input:focus {
  border-color: var(--color-accent);
}

/* ── Delete button ─────────────────────────────────── */

.btn-del {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.btn-del:hover {
  background: var(--color-danger-subtle);
  color: var(--color-danger);
}

/* ── Empty state ───────────────────────────────────── */

.empty-hint {
  text-align: center;
  padding: 20px 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

/* ── Actions row ───────────────────────────────────── */

.probe-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  gap: 10px;
  flex-wrap: wrap;
}

.probe-actions-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-add {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  font-size: 0.78rem;
  font-weight: 500;
  font-family: var(--font-sans);
  border: 1px dashed var(--color-border);
  border-radius: var(--border-radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-save {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 0.82rem;
  font-weight: 500;
  font-family: var(--font-sans);
  border: 1px solid var(--color-accent);
  border-radius: var(--border-radius-sm);
  background: var(--color-accent);
  color: var(--color-text-inverse);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-save:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── Save badge ────────────────────────────────────── */

.save-badge {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 100px;
  background: var(--color-success-subtle);
  color: var(--color-success);
  white-space: nowrap;
}

.save-badge.error {
  background: var(--color-danger-subtle);
  color: var(--color-danger);
}

@media (max-width: 520px) {
  .settings-section {
    padding: 16px 12px;
  }

  .probe-table,
  .probe-table tbody {
    display: block;
    width: 100%;
  }

  .probe-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .probe-row {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) 80px 32px;
    align-items: center;
    padding: 5px 0;
    border-bottom: 1px solid var(--color-border-light);
  }

  .probe-table td {
    width: auto;
    padding: 3px;
    border-bottom: 0;
  }

  .probe-row .col-grip {
    grid-column: 1;
    grid-row: 1 / span 2;
  }

  .probe-row .col-name {
    grid-column: 2;
    grid-row: 1;
  }

  .probe-row .col-cat {
    grid-column: 3;
    grid-row: 1;
  }

  .probe-row .col-host {
    grid-column: 2 / span 2;
    grid-row: 2;
  }

  .probe-row .col-del {
    grid-column: 4;
    grid-row: 1 / span 2;
  }

  .col-cat .field-input {
    padding-inline: 5px;
    font-size: 0.75rem;
  }
}
</style>
