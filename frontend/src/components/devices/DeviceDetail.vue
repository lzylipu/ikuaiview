<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import type { Device } from '@/types/dashboard';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import {
  deviceIcon,
  typeLabel,
  signalColor,
  signalLabel,
  signalQuality,
  formatDuration,
  formatLeaseExpiry,
  dhcpStatusLabel,
  arpStatusLabel,
} from '@/composables/useDeviceHelpers';
import { useDeviceOverrides } from '@/composables/useDeviceOverrides';
import { useAuthStore } from '@/stores/auth';

const {
  displayName,
  displayType,
  getOverride,
  hasOverride,
  saveOverride,
} = useDeviceOverrides();
const auth = useAuthStore();

// ── Device type options for the edit dropdown ────────────────

const DEVICE_TYPE_OPTIONS = [
  { value: '', label: '自动识别' },
  { value: 'phone', label: '手机' },
  { value: 'tablet', label: '平板' },
  { value: 'laptop', label: '笔记本' },
  { value: 'desktop', label: '桌面' },
  { value: 'iot', label: '物联网' },
  { value: 'router', label: '路由器' },
  { value: 'switch', label: '交换机' },
  { value: 'apple', label: 'Apple' },
  { value: 'media', label: '媒体设备' },
  { value: 'camera', label: '摄像头' },
  { value: 'printer', label: '打印机' },
];

// ── Edit mode state ─────────────────────────────────────────

const isEditing = ref(false);
const editName = ref('');
const editType = ref('');
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const editingMac = ref<string | null>(null);

function startEditing() {
  if (!props.device) return;
  const override = getOverride(props.device);
  editName.value = override.custom_name || '';
  editType.value = override.custom_type || '';
  editingMac.value = props.device.mac;
  saveError.value = null;
  isEditing.value = true;
}

function cancelEditing() {
  isEditing.value = false;
  editingMac.value = null;
  saveError.value = null;
}

async function saveEdit() {
  const mac = editingMac.value;
  if (!mac || props.device?.mac !== mac) return;
  isSaving.value = true;
  saveError.value = null;
  try {
    const name = editName.value.trim() || null;
    const type = editType.value || null;
    await saveOverride(mac, name, type);
    if (props.device?.mac === mac) {
      isEditing.value = false;
      editingMac.value = null;
    }
  } catch (e) {
    console.error('[DeviceDetail] Save override failed:', e);
    saveError.value = '保存失败，请重试';
  } finally {
    isSaving.value = false;
  }
}

const props = defineProps<{
  device: Device | null;
  isOverlay: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const panelRef = ref<HTMLElement | null>(null);

watch(
  () => props.device?.mac,
  () => {
    isEditing.value = false;
    editingMac.value = null;
    saveError.value = null;
    if (props.isOverlay && props.device) nextTick(() => panelRef.value?.focus());
  },
  { immediate: true },
);

function onPanelKeydown(event: KeyboardEvent) {
  if (!props.isOverlay) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key !== 'Tab' || !panelRef.value) return;

  const focusable = Array.from(panelRef.value.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('hidden'));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

const copiedLabel = ref<string | null>(null);

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedLabel.value = label;
    setTimeout(() => {
      if (copiedLabel.value === label) copiedLabel.value = null;
    }, 1500);
  } catch {
    // Clipboard not available
  }
}

function signalWidth(dbm: number | null | undefined): string {
  if (dbm == null) return '0%';
  // Map -100..-30 dBm → 0..100%
  const pct = Math.max(0, Math.min(100, ((dbm + 100) / 70) * 100));
  return `${pct.toFixed(0)}%`;
}
</script>

<template>
  <!-- Placeholder when no device is selected -->
  <div v-if="!device" class="card detail-placeholder">
    <FeatherIcon name="monitor" :size="48" :stroke-width="1" />
    <span>选择一个设备查看详情</span>
  </div>

  <!-- Device detail -->
  <div
    v-else
    ref="panelRef"
    class="card detail-panel"
    :class="{ overlay: isOverlay }"
    :role="isOverlay ? 'dialog' : undefined"
    :aria-modal="isOverlay ? 'true' : undefined"
    aria-labelledby="device-detail-title"
    :tabindex="isOverlay ? -1 : undefined"
    @keydown="onPanelKeydown"
  >
    <!-- Back button (overlay mode only) -->
    <button v-if="isOverlay" class="back-btn" type="button" @click="emit('close')">
      <FeatherIcon name="arrow-left" :size="20" />
      <span>返回</span>
    </button>

    <!-- Device header -->
    <div class="detail-header">
      <FeatherIcon :name="deviceIcon(displayType(device))" :size="22" />
      <div class="detail-header-info">
        <div class="detail-hostname-row">
          <span id="device-detail-title" class="detail-hostname">{{ displayName(device) }}</span>
          <span v-if="hasOverride(device)" class="override-badge" title="已自定义">
            <FeatherIcon name="edit-2" :size="10" />
          </span>
        </div>
        <span class="detail-type">{{ typeLabel(displayType(device)) }}</span>
      </div>
      <!-- Signal quality indicator for wireless -->
      <div v-if="device.signal != null" class="detail-signal-pill" :style="{ color: signalColor(device.signal) }">
        <FeatherIcon name="wifi" :size="12" />
        <span>{{ signalLabel(device.signal) }}</span>
      </div>
      <!-- Edit button -->
      <button
        v-if="!isEditing && auth.can('manage_devices')"
        class="edit-btn"
        type="button"
        title="编辑备注和类型"
        aria-label="编辑备注和类型"
        @click="startEditing"
      >
        <FeatherIcon name="edit-2" :size="14" />
      </button>
    </div>

    <!-- Edit form -->
    <div v-if="isEditing" class="edit-form">
      <div class="edit-field">
        <label class="edit-label" for="device-edit-name">备注名称</label>
        <input
          v-model="editName"
          id="device-edit-name"
          type="text"
          class="edit-input"
          :placeholder="device.hostname"
        />
      </div>
      <div class="edit-field">
        <label class="edit-label" for="device-edit-type">设备类型</label>
        <select id="device-edit-type" v-model="editType" class="edit-select">
          <option
            v-for="opt in DEVICE_TYPE_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </div>
      <div v-if="saveError" class="edit-error">{{ saveError }}</div>
      <div class="edit-actions">
        <button class="save-btn" type="button" :disabled="isSaving" @click="saveEdit">
          <span v-if="isSaving" class="save-spinner" />
          <span>{{ isSaving ? '保存中...' : '保存' }}</span>
        </button>
        <button class="cancel-btn" type="button" @click="cancelEditing">取消</button>
      </div>
    </div>

    <div class="detail-body">
      <!-- Connection section -->
      <div class="detail-section">
        <div class="section-title">连接信息</div>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">IP 地址</span>
            <span class="detail-value mono">{{ device.ip }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">MAC 地址</span>
            <span class="detail-value mono">{{ device.mac }}</span>
          </div>
          <div v-if="device.interface" class="detail-item">
            <span class="detail-label">接口</span>
            <span class="detail-value mono">{{ device.interface }}</span>
          </div>
          <div v-if="device.arp_status" class="detail-item">
            <span class="detail-label">ARP 状态</span>
            <span class="detail-value">{{ arpStatusLabel(device.arp_status) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">在线时长</span>
            <span class="detail-value">{{ formatDuration(device.connected_duration) }}</span>
          </div>
        </div>
      </div>

      <!-- DHCP section -->
      <div class="detail-section">
        <div class="section-title">DHCP</div>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">状态</span>
            <span
              class="detail-value"
              :class="{ 'text-success': dhcpStatusLabel(device.dhcp_status).type === 'dynamic', 'text-muted': dhcpStatusLabel(device.dhcp_status).type === 'static' }"
            >
              {{ dhcpStatusLabel(device.dhcp_status).text }}
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">租约剩余</span>
            <span
              class="detail-value mono"
              :class="{ 'text-warning': formatLeaseExpiry(device.dhcp_expires).isExpiringSoon }"
            >
              {{ formatLeaseExpiry(device.dhcp_expires).text }}
            </span>
          </div>
        </div>
      </div>

      <!-- Wireless section (only for wireless devices) -->
      <div v-if="device.signal != null" class="detail-section">
        <div class="section-title">无线信号</div>
        <div class="signal-area">
          <div class="signal-row">
            <span class="detail-label">信号强度</span>
            <span class="detail-value mono" :style="{ color: signalColor(device.signal) }">
              {{ signalLabel(device.signal) }}
            </span>
          </div>
          <div class="signal-bar-track">
            <div
              class="signal-bar-fill"
              :style="{
                width: signalWidth(device.signal),
                backgroundColor: signalColor(device.signal),
              }"
            />
          </div>
          <div class="signal-quality-label" :style="{ color: signalColor(device.signal) }">
            {{
              signalQuality(device.signal) === 'excellent' ? '优秀' :
              signalQuality(device.signal) === 'good' ? '良好' :
              signalQuality(device.signal) === 'poor' ? '较弱' : ''
            }}
          </div>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="detail-actions">
      <button class="action-btn" type="button" @click="copyToClipboard(device.mac, 'MAC')">
        <FeatherIcon name="copy" :size="14" />
        <span>{{ copiedLabel === 'MAC' ? '已复制' : '复制 MAC' }}</span>
      </button>
      <button class="action-btn" type="button" @click="copyToClipboard(device.ip, 'IP')">
        <FeatherIcon name="copy" :size="14" />
        <span>{{ copiedLabel === 'IP' ? '已复制' : '复制 IP' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.detail-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-muted);
  font-size: 0.85rem;
  min-height: 200px;
}

.detail-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
  min-height: 0;
}

.detail-panel.overlay {
  flex: 1;
  border-radius: 0;
  border: none;
  overflow-y: auto;
  padding: var(--card-padding);
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--border-radius-sm);
  background: transparent;
  color: var(--color-accent);
  cursor: pointer;
  font-size: 0.85rem;
  font-family: var(--font-sans);
  font-weight: 500;
  align-self: flex-start;
  transition: background var(--transition-fast);
}

.back-btn:hover {
  background: var(--color-accent-subtle);
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.detail-header-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.detail-hostname {
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-type {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.detail-signal-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 100px;
  font-size: 0.7rem;
  font-weight: 600;
  font-family: var(--font-mono);
  background: var(--color-bg-input);
  flex-shrink: 0;
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--color-border-light);
}

.detail-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 6px;
  border-radius: 4px;
}

.detail-item:hover {
  background: var(--color-bg-hover);
}

.detail-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.detail-value {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-primary);
  text-align: right;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.signal-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--color-bg-input);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--color-border-light);
}

.signal-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.signal-bar-track {
  height: 6px;
  background: var(--color-bg-hover);
  border-radius: 3px;
  overflow: hidden;
}

.signal-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width var(--transition-normal);
}

.signal-quality-label {
  font-size: 0.7rem;
  font-weight: 500;
  text-align: right;
}

.detail-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-light);
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 0.75rem;
  font-family: var(--font-sans);
  transition: all var(--transition-fast);
}

.action-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border);
}

/* ── Edit mode ─────────────────────────────────────────── */

.edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  aspect-ratio: 1;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.edit-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-accent);
}

.detail-hostname-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.override-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent-subtle);
  color: var(--color-accent);
  flex-shrink: 0;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--color-bg-input);
  border: 1px solid var(--color-accent-border);
  border-radius: var(--border-radius-sm);
}

.edit-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.edit-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.edit-input {
  padding: 6px 10px;
  font-size: 0.82rem;
  font-family: var(--font-sans);
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  outline: none;
  transition: border-color var(--transition-fast);
}

.edit-input:focus {
  border-color: var(--color-accent);
}

.edit-select {
  padding: 6px 10px;
  font-size: 0.82rem;
  font-family: var(--font-sans);
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  outline: none;
  cursor: pointer;
  transition: border-color var(--transition-fast);
}

.edit-select:focus {
  border-color: var(--color-accent);
}

.edit-error {
  font-size: 0.72rem;
  color: var(--color-danger);
}

.edit-actions {
  display: flex;
  gap: 8px;
}

.save-btn,
.cancel-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 0.78rem;
  font-weight: 500;
  font-family: var(--font-sans);
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.save-btn {
  border: 1px solid var(--color-accent);
  background: var(--color-accent);
  color: var(--color-text-inverse);
}

.save-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.cancel-btn {
  border: 1px solid var(--color-border-light);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
}

.cancel-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.save-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
