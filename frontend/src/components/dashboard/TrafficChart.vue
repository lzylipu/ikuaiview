<script setup lang="ts">
import { computed, watch, ref, nextTick, onMounted, onUnmounted } from 'vue';
import { useDashboardStore } from '@/stores/dashboard';
import { useThemeStore } from '@/stores/theme';
import { storeToRefs } from 'pinia';
import { useECharts } from '@/composables/useECharts';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import {
  buildTrafficChartOption,
  formatBitrate,
  TIME_RANGE_OPTIONS,
  timeRangeToMs,
  type TimeRange,
  type TrafficChartData,
} from '@/types/charts';
import {
  fetchTrafficHistory,
  type TrafficHistoryResponse,
  type TrafficHistorySelector,
  type TrafficInterfaceMetadata,
} from '@/api/index';
import { trafficHistoryErrorMessage } from '@/utils/trafficHistory';

const dashboardStore = useDashboardStore();
const themeStore = useThemeStore();
const {
  trafficPoints,
  trafficTimeRange,
  currentDownloadBps,
  currentUploadBps,
  hasMultipleWans,
  wanNames,
  selectedWan,
  wanTrafficPoints,
} = storeToRefs(dashboardStore);

const isDark = computed(() => themeStore.mode === 'dark');
const { chartRef, initChart, updateOption, hasInstance } = useECharts(isDark);

// Historical backfill from API — survives server restarts
const historyPoints = ref<TrafficChartData[]>([]);
const historyLoading = ref(false);
const historyError = ref<string | null>(null);
const trafficInterfaces = ref<TrafficInterfaceMetadata[]>([]);
const selectedInterfaceId = ref<string | null>(null);
let historyController: AbortController | null = null;
let historyGeneration = 0;
let loadedHistoryKey: string | null = null;
let ignoreNextWanSelection = false;

const interfaceOptions = computed(() => {
  if (trafficInterfaces.value.length > 0) {
    const nameCounts = new Map<string, number>();
    for (const candidate of trafficInterfaces.value) {
      nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1);
    }
    return trafficInterfaces.value.map((candidate) => ({
      value: candidate.id,
      label: (nameCounts.get(candidate.name) ?? 0) > 1
        ? `${candidate.name} (${candidate.id})`
        : candidate.name,
    }));
  }
  return wanNames.value.map((name) => ({ value: `legacy:${name}`, label: name }));
});
const hasInterfaceSelector = computed(() => interfaceOptions.value.length > 1 || hasMultipleWans.value);
const selectedInterfaceValue = computed(() => selectedInterfaceId.value
  ?? (selectedWan.value ? `legacy:${selectedWan.value}` : ''));
const selectedInterfaceHasDuplicateName = computed(() => {
  if (!selectedInterfaceId.value) return false;
  const selected = trafficInterfaces.value.find(
    (candidate) => candidate.id === selectedInterfaceId.value,
  );
  return selected !== undefined
    && trafficInterfaces.value.filter((candidate) => candidate.name === selected.name).length > 1;
});
const useHistoricalRate = computed(() => selectedInterfaceId.value !== null
  && (!selectedWan.value || selectedInterfaceHasDuplicateName.value));
const latestHistoryPoint = computed(() => historyPoints.value.at(-1));
const downloadRateStr = computed(() => formatBitrate(
  useHistoricalRate.value
    ? latestHistoryPoint.value?.download_bps ?? 0
    : currentDownloadBps.value,
));
const uploadRateStr = computed(() => formatBitrate(
  useHistoricalRate.value
    ? latestHistoryPoint.value?.upload_bps ?? 0
    : currentUploadBps.value,
));

function historySelector(): TrafficHistorySelector | undefined {
  if (selectedInterfaceId.value) return { interfaceId: selectedInterfaceId.value };
  if (selectedWan.value) return { wanName: selectedWan.value };
  return undefined;
}

function applyInterfaceMetadata(response: TrafficHistoryResponse): void {
  if (!response.wan_interfaces || response.wan_interfaces.length === 0) return;
  trafficInterfaces.value = response.wan_interfaces;
  if (response.interface && !response.interface.aggregate) {
    selectedInterfaceId.value = response.interface.id;
  } else if (
    selectedInterfaceId.value
    && !trafficInterfaces.value.some((candidate) => candidate.id === selectedInterfaceId.value)
  ) {
    selectedInterfaceId.value = null;
  }
}

async function loadHistory(range: TimeRange) {
  historyController?.abort();
  const controller = new AbortController();
  historyController = controller;
  const generation = ++historyGeneration;
  const selector = historySelector();
  const historyKey = `${range}\u0000${selector?.interfaceId ?? selector?.wanName ?? ''}`;
  historyLoading.value = true;
  historyError.value = null;
  if (loadedHistoryKey !== historyKey) historyPoints.value = [];
  try {
    const endMs = Date.now();
    const startMs = endMs - timeRangeToMs(range);
    const resp: TrafficHistoryResponse = await fetchTrafficHistory(
      startMs,
      endMs,
      selector,
      controller.signal,
    );
    if (generation !== historyGeneration) return;
    applyInterfaceMetadata(resp);
    historyPoints.value = resp.points.map((p) => ({
      timestamp: new Date(p.timestamp_ms).toISOString(),
      download_bps: p.download_bps,
      upload_bps: p.upload_bps,
      wan_name: p.wan_name ?? undefined,
    }));
    loadedHistoryKey = historyKey;
  } catch (error: unknown) {
    if (controller.signal.aborted || generation !== historyGeneration) return;
    historyError.value = trafficHistoryErrorMessage(error);
  } finally {
    if (generation === historyGeneration) historyLoading.value = false;
  }
}

// Merge WS live data with API history. WS timestamps take priority.
// When a specific WAN is selected, uses per-WAN traffic; otherwise aggregate.
const mergedPoints = computed<TrafficChartData[]>(() => {
  const livePoints = selectedInterfaceId.value
    ? selectedWan.value && !selectedInterfaceHasDuplicateName.value
      ? wanTrafficPoints.value
      : []
    : selectedWan.value
      ? wanTrafficPoints.value
      : trafficPoints.value;

  const merged = new Map<number, TrafficChartData>();
  const cutoff = Date.now() - timeRangeToMs(trafficTimeRange.value);
  // API history first (base layer)
  for (const p of historyPoints.value) {
    const timestamp = Date.parse(p.timestamp);
    if (Number.isFinite(timestamp) && timestamp >= cutoff) merged.set(timestamp, p);
  }
  // WS data overwrites (more real-time)
  for (const p of livePoints) {
    const timestamp = Date.parse(p.timestamp);
    if (Number.isFinite(timestamp) && timestamp >= cutoff) merged.set(timestamp, p);
  }
  return Array.from(merged.entries())
    .sort(([a], [b]) => a - b)
    .map(([, point]) => point);
});

// Build & update chart when data or theme changes
function renderChart() {
  const option = buildTrafficChartOption(
    mergedPoints.value,
    isDark.value,
    trafficTimeRange.value,
  );
  if (hasInstance()) {
    updateOption(option, false);
  } else {
    initChart(option);
  }
}

// Watch for data changes
watch(
  [mergedPoints, isDark, trafficTimeRange],
  () => {
    nextTick(renderChart);
  },
  { deep: true },
);

watch(trafficTimeRange, (range) => {
  loadHistory(range);
});

watch(selectedWan, (wanName) => {
  if (ignoreNextWanSelection) {
    ignoreNextWanSelection = false;
    return;
  }
  if (!wanName) {
    selectedInterfaceId.value = null;
  } else {
    const selected = trafficInterfaces.value.find(
      (candidate) => candidate.id === selectedInterfaceId.value,
    );
    if (selected?.name !== wanName) {
      selectedInterfaceId.value = trafficInterfaces.value.find(
        (candidate) => candidate.name === wanName,
      )?.id ?? null;
    }
  }
  loadHistory(trafficTimeRange.value);
});

function selectInterface(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (!value) {
    selectedInterfaceId.value = null;
    updateLiveWanSelection(null);
    loadHistory(trafficTimeRange.value);
    return;
  }
  if (value.startsWith('legacy:')) {
    selectedInterfaceId.value = null;
    updateLiveWanSelection(value.slice('legacy:'.length) || null);
    loadHistory(trafficTimeRange.value);
    return;
  }

  selectedInterfaceId.value = value;
  const selected = trafficInterfaces.value.find((candidate) => candidate.id === value);
  updateLiveWanSelection(selected?.name ?? null);
  loadHistory(trafficTimeRange.value);
}

function updateLiveWanSelection(wanName: string | null): void {
  const liveWanName = wanName && wanNames.value.includes(wanName) ? wanName : null;
  if (selectedWan.value === liveWanName) return;
  ignoreNextWanSelection = true;
  dashboardStore.selectWan(liveWanName);
}

function selectTimeRange(range: TimeRange) {
  dashboardStore.setTrafficTimeRange(range);
}

onMounted(() => {
  loadHistory(trafficTimeRange.value);
});

onUnmounted(() => {
  historyGeneration++;
  historyController?.abort();
});
</script>

<template>
  <div class="card traffic-chart">
    <!-- Top Controls -->
    <div class="chart-controls">
      <div class="chart-title-row">
        <div class="chart-selector">
          <FeatherIcon name="activity" :size="16" />
          <span class="chart-title">互联网流量</span>
        </div>
        <div class="chart-rates">
          <div class="rate-item download">
            <FeatherIcon name="download" :size="12" :stroke-width="2.5" />
            <span class="rate-label">下载</span>
            <span class="rate-value mono">{{ downloadRateStr }}</span>
          </div>
          <div class="rate-item upload">
            <FeatherIcon name="upload" :size="12" :stroke-width="2.5" />
            <span class="rate-label">上传</span>
            <span class="rate-value mono">{{ uploadRateStr }}</span>
          </div>
        </div>
      </div>

      <!-- Right controls: WAN selector + time range -->
      <div class="chart-controls-right">
        <select
          v-if="hasInterfaceSelector"
          class="wan-select"
          aria-label="选择 WAN 接口"
          :value="selectedInterfaceValue"
          @change="selectInterface"
        >
          <option value="">全部 (合计)</option>
          <option v-for="option in interfaceOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>

        <div class="time-range-switcher">
          <button
            v-for="opt in TIME_RANGE_OPTIONS"
            :key="opt.key"
            class="time-btn"
            type="button"
            :aria-pressed="trafficTimeRange === opt.key"
            :class="{ active: trafficTimeRange === opt.key }"
            @click="selectTimeRange(opt.key)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Chart Area -->
    <div class="chart-container" :aria-busy="historyLoading">
      <div v-if="historyError" class="history-warning" role="alert">
        <FeatherIcon name="alert-triangle" :size="13" />
        <span>
          {{ historyError }}{{ mergedPoints.length > 0 ? '，正在显示已有数据' : '' }}
        </span>
        <button type="button" @click="loadHistory(trafficTimeRange)">重试</button>
      </div>
      <div
        v-if="mergedPoints.length === 0"
        class="chart-placeholder"
      >
        <FeatherIcon name="activity" :size="48" :stroke-width="1" />
        <span v-if="historyLoading">加载历史数据...</span>
        <span v-else>暂无流量数据</span>
      </div>
      <div ref="chartRef" class="chart-canvas" />
    </div>
  </div>
</template>

<style scoped>
.traffic-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 320px;
}

.chart-controls {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
}

.chart-title-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chart-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
}

.chart-title {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.chart-rates {
  display: flex;
  gap: 16px;
}

.rate-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
}

.rate-item.download {
  color: var(--color-success);
}

.rate-item.upload {
  color: var(--color-accent);
}

.rate-value {
  font-weight: 600;
}

.chart-controls-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.wan-select {
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

.time-range-switcher {
  display: flex;
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  overflow: hidden;
  background: var(--color-bg-input);
}

.time-btn {
  padding: 4px 12px;
  font-size: 0.75rem;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-family: var(--font-sans);
}

.time-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.time-btn.active {
  background: var(--color-accent);
  color: var(--color-text-inverse);
  font-weight: 600;
}

.chart-container {
  flex: 1;
  position: relative;
  min-height: 240px;
}

.chart-canvas {
  width: 100%;
  height: 100%;
  min-height: 240px;
}

.chart-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.history-warning {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 8px);
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 35%, transparent);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-card);
  color: var(--color-warning);
  font-size: 0.68rem;
}

.history-warning button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}
</style>
