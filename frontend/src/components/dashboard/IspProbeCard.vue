<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import { useDashboardStore } from '@/stores/dashboard';
import { storeToRefs } from 'pinia';
import StatusBadge from '@/components/shared/StatusBadge.vue';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';

const store = useDashboardStore();
const {
  isp,
  latencyProbes,
  hasMultipleWans,
  wansIsp,
  wans,
  wanNames,
  selectedWan,
  currentDownloadBps,
  currentUploadBps,
} = storeToRefs(store);

const rate = {
  formatValue(bps: number): string {
    if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1);
    return (bps / 1_000).toFixed(1);
  },
  formatUnit(bps: number): string {
    if (bps >= 1_000_000) return 'Mbps';
    return 'Kbps';
  },
};

/// Current ISP display: selected WAN's ISP info, or primary fallback
const currentIspName = computed(() => {
  if (hasMultipleWans.value && selectedWan.value) {
    const match = wansIsp.value.find((w) => w.wan_name === selectedWan.value);
    if (match) return match.name;
    return selectedWan.value;
  }
  return isp.value.name;
});

const currentIspOnline = computed(() => {
  if (hasMultipleWans.value && selectedWan.value) {
    const match = wansIsp.value.find((w) => w.wan_name === selectedWan.value);
    if (match) return match.online;
    return wans.value.find((wan) => wan.wan_name === selectedWan.value)?.online ?? false;
  }
  // No WAN selected — online iff at least one WAN is up
  if (hasMultipleWans.value) {
    return wansIsp.value.some((w) => w.online);
  }
  return isp.value.online;
});

const latStatusColor = (status: string): string => {
  switch (status) {
    case 'good': return 'var(--color-success)';
    case 'moderate': return 'var(--color-warning)';
    case 'poor': return 'var(--color-danger)';
    default: return 'var(--color-text-muted)';
  }
};

const latStatusLabel = (status: string): string => {
  switch (status) {
    case 'good': return '低延迟';
    case 'moderate': return '一般';
    case 'poor': return '高延迟';
    default: return '未知';
  }
};

const latDisplay = (ms: number | null): string => {
  if (ms === null) return '—';
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(0)}ms`;
};

const probesByCategory = computed(() => {
  const cats: Record<string, typeof latencyProbes.value> = {};
  for (const probe of latencyProbes.value) {
    if (!cats[probe.category]) cats[probe.category] = [];
    cats[probe.category].push(probe);
  }
  return cats;
});

const categoryNames: Record<string, string> = {
  isp: '运营商',
  dns: '公共 DNS',
  cloud: '云服务',
  cdn: 'CDN',
  repo: '仓库源',
};

// Capture client time when probes arrive, then tick locally.
// Avoids clock-skew issues with server timestamps.
const lastProbeAt = ref(Date.now());
watch(latencyProbes, () => { lastProbeAt.value = Date.now(); });

const now = ref(Date.now());
const clockTimer = setInterval(() => { now.value = Date.now(); }, 1000);
onUnmounted(() => clearInterval(clockTimer));

const secondsSinceLastProbe = computed(() => {
  if (latencyProbes.value.length === 0) return null;
  return Math.floor((now.value - lastProbeAt.value) / 1000);
});

const probeCount = computed(() => latencyProbes.value.length);
const goodProbes = computed(() => latencyProbes.value.filter(p => p.status === 'good').length);
</script>

<template>
  <div class="card isp-probe-card">
    <!-- ISP Header -->
    <div class="isp-header">
      <div class="isp-name-col">
        <span class="isp-name">{{ currentIspName }}</span>
        <StatusBadge :status="currentIspOnline ? 'online' : 'offline'" :pulse="true" />
      </div>
      <div class="isp-usage">
        <span class="usage-label">本月用量</span>
        <span class="usage-value">{{ isp.monthly_usage_gb.toFixed(0) }} GB</span>
      </div>
    </div>

    <!-- WAN Selector (multi-WAN) -->
    <div v-if="hasMultipleWans" class="wan-select-row">
      <select
        class="wan-select"
        aria-label="选择 WAN 接口"
        :value="selectedWan ?? ''"
        @change="store.selectWan($event.target ? ($event.target as HTMLSelectElement).value || null : null)"
      >
        <option value="">全部 (合计)</option>
        <option v-for="name in wanNames" :key="name" :value="name">{{ name }}</option>
      </select>
    </div>

    <!-- Real-time rates -->
    <div class="isp-rates">
      <div class="rate-item download">
        <FeatherIcon name="download" :size="14" :stroke-width="2.5" />
        <span class="rate-value">{{ rate.formatValue(currentDownloadBps) }}</span>
        <span class="rate-unit">{{ rate.formatUnit(currentDownloadBps) }}</span>
      </div>
      <div class="rate-item upload">
        <FeatherIcon name="upload" :size="14" :stroke-width="2.5" />
        <span class="rate-value">{{ rate.formatValue(currentUploadBps) }}</span>
        <span class="rate-unit">{{ rate.formatUnit(currentUploadBps) }}</span>
      </div>
      <div class="rate-item connections">
        <FeatherIcon name="link" :size="14" :stroke-width="2.5" />
        <span class="rate-value">{{ (isp.connection_count || 0).toLocaleString() }}</span>
        <span class="rate-unit">v4连接</span>
      </div>
      <div v-if="isp.connection_count_ipv6 !== undefined" class="rate-item connections">
        <FeatherIcon name="link" :size="14" :stroke-width="2.5" />
        <span class="rate-value">{{ isp.connection_count_ipv6.toLocaleString() }}</span>
        <span class="rate-unit">v6连接</span>
      </div>
    </div>

    <!-- Latency Probes -->
    <div class="probes-section" role="region" aria-label="延迟探针列表" tabindex="0">
      <div class="probes-header">
        <span>网络延迟探测</span>
        <span class="probes-summary">
          {{ goodProbes }}/{{ probeCount }} 正常
        </span>
      </div>

      <div
        v-for="(probes, cat) in probesByCategory"
        :key="cat"
        class="probe-category"
      >
        <div class="probe-cat-label">{{ categoryNames[cat] || cat }}</div>
        <div class="probe-list">
          <div
            v-for="probe in probes"
            :key="probe.target"
            class="probe-item"
          >
            <div class="probe-target">
              <span class="probe-name">{{ probe.target }}</span>
              <span class="probe-host mono">{{ probe.host }}</span>
            </div>
            <div class="probe-result" :style="{ color: latStatusColor(probe.status) }">
              <span class="probe-latency mono">{{ latDisplay(probe.latency_ms) }}</span>
              <span class="probe-status">{{ latStatusLabel(probe.status) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Update info -->
    <div class="probe-footer">
      <FeatherIcon name="clock" :size="12" />
      <span>每 1 分钟探测一次{{ secondsSinceLastProbe !== null ? `，上次探测于 ${secondsSinceLastProbe}秒前` : '' }}</span>
    </div>
  </div>
</template>

<style scoped>
.isp-probe-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

.isp-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-shrink: 0;
}

.isp-name-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.isp-name {
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-text-primary);
}

.isp-usage {
  text-align: right;
}

.usage-label {
  display: block;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.usage-value {
  font-size: 1.2rem;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
}

.wan-select-row {
  margin-top: -6px;
}

.wan-select {
  width: 100%;
  padding: 4px 8px;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: var(--font-sans);
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  cursor: pointer;
  outline: none;
  transition: border-color var(--transition-fast);
}

.wan-select:focus {
  border-color: var(--color-accent);
}

.isp-rates {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-evenly;
  gap: 8px 12px;
  padding: 10px 12px;
  background: var(--color-bg-input);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--color-border-light);
  flex-shrink: 0;
}

.rate-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  flex-shrink: 0;
  white-space: nowrap;
}

.rate-item.download {
  color: var(--color-success);
}

.rate-item.upload {
  color: var(--color-accent);
}

.rate-item.connections {
  color: var(--color-text-secondary);
}

.rate-value {
  font-weight: 600;
  font-size: 1rem;
}

.rate-unit {
  font-size: 0.7rem;
}

.probes-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.probes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.probes-summary {
  font-size: 0.7rem;
  color: var(--color-success);
  font-weight: 500;
}

.probe-category {
  margin-top: 2px;
}

.probe-cat-label {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--color-border-light);
}

.probe-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.probe-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 6px;
  border-radius: 4px;
  transition: background var(--transition-fast);
}

.probe-item:hover {
  background: var(--color-bg-hover);
}

.probe-target {
  display: flex;
  flex-direction: column;
}

.probe-name {
  font-size: 0.78rem;
  color: var(--color-text-primary);
}

.probe-host {
  font-size: 0.65rem;
  color: var(--color-text-muted);
}

.probe-result {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.probe-latency {
  font-size: 0.85rem;
  font-weight: 600;
}

.probe-status {
  font-size: 0.6rem;
  opacity: 0.8;
}

.probe-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.65rem;
  color: var(--color-text-muted);
  padding-top: 6px;
  border-top: 1px solid var(--color-border-light);
  flex-shrink: 0;
}
</style>
