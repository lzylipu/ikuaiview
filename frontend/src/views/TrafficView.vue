<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useThemeStore } from '@/stores/theme';
import { useDashboardStore } from '@/stores/dashboard';
import { storeToRefs } from 'pinia';
import { useECharts } from '@/composables/useECharts';
import { useEChartsDataZoom } from '@/composables/useEChartsDataZoom';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import {
  buildTrafficChartOption,
  formatBitrate,
  HISTORY_TIME_RANGE_OPTIONS,
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
import {
  formatByteCount,
  isAbortError,
  resolveTrafficTotals,
  trafficHistoryErrorMessage,
} from '@/utils/trafficHistory';

const themeStore = useThemeStore();
const dashboardStore = useDashboardStore();
const { wanNames, selectedWan } = storeToRefs(dashboardStore);
const isDark = computed(() => themeStore.mode === 'dark');
useEChartsDataZoom();
const { chartRef, initChart, updateOption, hasInstance } = useECharts(isDark);

const selectedRange = ref<TimeRange | 'custom'>('6H');
const customStart = ref('');
const customEnd = ref('');
const loading = ref(false);
const error = ref<string | null>(null);
const chartData = ref<TrafficChartData[]>([]);
const intervalSecs = ref<number | null>(null);
const totalDownload = ref(0n);
const totalUpload = ref(0n);
const exactDownload = ref<bigint | null>(null);
const exactUpload = ref<bigint | null>(null);
const estimatedDownload = ref<bigint | null>(null);
const estimatedUpload = ref<bigint | null>(null);
const totalsEstimated = ref(false);
const totalsComplete = ref(true);
const coverageRatio = ref<number | null>(null);
const gapCount = ref<number | null>(null);
const trafficInterfaces = ref<TrafficInterfaceMetadata[]>([]);
const selectedInterfaceId = ref<string | null>(null);
const selectedLegacyWanName = ref<string | null>(selectedWan.value);
let requestController: AbortController | null = null;
let requestGeneration = 0;

interface InterfaceOption {
  value: string;
  label: string;
}

const interfaceOptions = computed<InterfaceOption[]>(() => {
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
const hasInterfaceSelector = computed(() => interfaceOptions.value.length > 1);
const selectedInterfaceValue = computed(() => selectedInterfaceId.value
  ?? (selectedLegacyWanName.value ? `legacy:${selectedLegacyWanName.value}` : ''));

const intervalLabel = computed(() =>
  intervalSecs.value === null ? '逐点' : `${intervalSecs.value}s`,
);
const staleError = computed(() => error.value !== null && chartData.value.length > 0);
const hasTotalsBreakdown = computed(() =>
  exactDownload.value !== null
  || exactUpload.value !== null
  || estimatedDownload.value !== null
  || estimatedUpload.value !== null,
);

function formatOptionalByteCount(value: bigint | null): string {
  return value === null ? '—' : formatByteCount(value);
}

function trafficSelector(): TrafficHistorySelector | undefined {
  if (selectedInterfaceId.value) return { interfaceId: selectedInterfaceId.value };
  if (selectedLegacyWanName.value) return { wanName: selectedLegacyWanName.value };
  return undefined;
}

function applyInterfaceMetadata(response: TrafficHistoryResponse): void {
  if (!response.wan_interfaces || response.wan_interfaces.length === 0) return;
  trafficInterfaces.value = response.wan_interfaces;

  if (response.interface && !response.interface.aggregate) {
    selectedInterfaceId.value = response.interface.id;
    selectedLegacyWanName.value = null;
    return;
  }
  if (
    selectedInterfaceId.value
    && !trafficInterfaces.value.some((candidate) => candidate.id === selectedInterfaceId.value)
  ) {
    selectedInterfaceId.value = null;
  }
}

function selectInterface(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value.startsWith('legacy:')) {
    selectedInterfaceId.value = null;
    selectedLegacyWanName.value = value.slice('legacy:'.length) || null;
  } else {
    selectedInterfaceId.value = value || null;
    selectedLegacyWanName.value = null;
  }
  void loadHistory(selectedRange.value);
}

function rangeLabel(range: TimeRange | 'custom'): string {
  if (range === 'custom') return '自定义';
  const opt = HISTORY_TIME_RANGE_OPTIONS.find(o => o.key === range);
  return opt?.label || range;
}

async function loadHistory(range: TimeRange | 'custom') {
  requestGeneration++;
  requestController?.abort();
  requestController = null;
  loading.value = false;

  let startMs: number;
  let endMs: number;

  if (range === 'custom') {
    if (!customStart.value || !customEnd.value) {
      return;
    }
    startMs = new Date(customStart.value).getTime();
    endMs = new Date(customEnd.value).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      error.value = '结束时间必须大于开始时间';
      return;
    }
  } else {
    endMs = Date.now();
    startMs = endMs - timeRangeToMs(range);
  }

  const controller = new AbortController();
  requestController = controller;
  const generation = requestGeneration;
  loading.value = true;
  error.value = null;

  try {
    const resp: TrafficHistoryResponse = await fetchTrafficHistory(
      startMs,
      endMs,
      trafficSelector(),
      controller.signal,
    );
    if (generation !== requestGeneration) return;

    applyInterfaceMetadata(resp);
    chartData.value = resp.points.map((p) => ({
      timestamp: new Date(p.timestamp_ms).toISOString(),
      download_bps: p.download_bps,
      upload_bps: p.upload_bps,
    }));
    intervalSecs.value = resp.bucket_size_ms === undefined
      ? resp.interval_secs ?? null
      : resp.bucket_size_ms / 1_000;
    const totals = resolveTrafficTotals(resp);
    totalDownload.value = totals.downloadBytes;
    totalUpload.value = totals.uploadBytes;
    exactDownload.value = totals.exactDownloadBytes;
    exactUpload.value = totals.exactUploadBytes;
    estimatedDownload.value = totals.estimatedDownloadBytes;
    estimatedUpload.value = totals.estimatedUploadBytes;
    totalsEstimated.value = totals.estimated;
    totalsComplete.value = totals.complete;
    coverageRatio.value = totals.coverageRatio;
    gapCount.value = totals.gapCount;

    await nextTick();
    renderChart();
  } catch (caught: unknown) {
    if (controller.signal.aborted || generation !== requestGeneration || isAbortError(caught)) {
      return;
    }
    error.value = trafficHistoryErrorMessage(caught);
  } finally {
    if (generation === requestGeneration) loading.value = false;
  }
}

function renderChart() {
  if (!chartRef.value || chartData.value.length === 0) return;
  const option = buildTrafficChartOption(
    chartData.value,
    isDark.value,
    selectedRange.value === 'custom' ? '7D' : selectedRange.value,
    { dataZoom: true },
  );
  if (hasInstance()) {
    updateOption(option, false);
  } else {
    initChart(option);
  }
}

function selectRange(range: TimeRange) {
  selectedRange.value = range;
  loadHistory(range);
}

function selectCustom() {
  selectedRange.value = 'custom';
  // Default to last 24h
  const now = new Date();
  customEnd.value = toLocalDatetime(now);
  const start = new Date(now.getTime() - 24 * 3600 * 1000);
  customStart.value = toLocalDatetime(start);
}

function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function applyCustom() {
  if (!customStart.value || !customEnd.value) return;
  loadHistory('custom');
}

watch([chartData, isDark], () => nextTick(renderChart), { deep: true });

onMounted(() => {
  loadHistory(selectedRange.value);
});

onUnmounted(() => {
  requestGeneration++;
  requestController?.abort();
});
</script>

<template>
  <div class="traffic-view">
    <div class="card traffic-card">
      <!-- Header -->
      <div class="traffic-header">
        <div class="traffic-title-row">
          <FeatherIcon name="bar-chart-2" :size="18" />
          <span class="traffic-title">流量历史</span>
        </div>
        <!-- Time range presets -->
        <div class="range-controls">
          <div class="range-controls-top">
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
                v-for="opt in HISTORY_TIME_RANGE_OPTIONS"
                :key="opt.key"
                class="time-btn"
                type="button"
                :aria-pressed="selectedRange === opt.key"
                :class="{ active: selectedRange === opt.key }"
                :disabled="loading"
                @click="selectRange(opt.key)"
              >
                {{ opt.label }}
              </button>
              <button
                class="time-btn"
                type="button"
                :aria-pressed="selectedRange === 'custom'"
                :class="{ active: selectedRange === 'custom' }"
                :disabled="loading"
                @click="selectCustom"
              >
                自定义
              </button>
            </div>
          </div>

          <!-- Custom date range inputs -->
          <div v-if="selectedRange === 'custom'" class="custom-range">
            <input
              aria-label="开始时间"
              type="datetime-local"
              class="date-input"
              v-model="customStart"
              :max="customEnd"
            />
            <span class="date-sep">—</span>
            <input
              aria-label="结束时间"
              type="datetime-local"
              class="date-input"
              v-model="customEnd"
              :min="customStart"
            />
            <button class="apply-btn" type="button" :disabled="loading" @click="applyCustom">
              <FeatherIcon name="search" :size="14" />
              <span>查询</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Summary stats -->
      <div class="traffic-summary">
        <div class="summary-item download">
          <FeatherIcon name="download" :size="14" />
          <div class="summary-text">
            <span class="summary-label">总下载</span>
            <span class="summary-value mono" :title="`${totalDownload.toString()} bytes`">
              {{ totalsEstimated ? '≈' : '' }}{{ formatByteCount(totalDownload) }}
            </span>
          </div>
        </div>
        <div class="summary-item upload">
          <FeatherIcon name="upload" :size="14" />
          <div class="summary-text">
            <span class="summary-label">总上传</span>
            <span class="summary-value mono" :title="`${totalUpload.toString()} bytes`">
              {{ totalsEstimated ? '≈' : '' }}{{ formatByteCount(totalUpload) }}
            </span>
          </div>
        </div>
        <div class="summary-item meta">
          <span class="summary-label">数据间隔</span>
          <span class="summary-value mono">{{ intervalLabel }}</span>
        </div>
        <div v-if="!totalsComplete" class="summary-item coverage" role="status">
          <FeatherIcon name="alert-triangle" :size="13" />
          <span>
            数据不完整{{ coverageRatio !== null ? ` (${(coverageRatio * 100).toFixed(0)}%)` : '' }}{{ gapCount ? `，${gapCount} 个缺口` : '' }}
          </span>
        </div>
        <div v-if="hasTotalsBreakdown" class="summary-breakdown" role="status">
          <span v-if="exactDownload !== null || exactUpload !== null">
            精确：下载 {{ formatOptionalByteCount(exactDownload) }} / 上传 {{ formatOptionalByteCount(exactUpload) }}
          </span>
          <span v-if="estimatedDownload !== null || estimatedUpload !== null">
            估算：下载 {{ formatOptionalByteCount(estimatedDownload) }} / 上传 {{ formatOptionalByteCount(estimatedUpload) }}
          </span>
        </div>
      </div>

      <!-- Chart -->
      <div class="chart-body" :aria-busy="loading">
        <div v-if="staleError" class="stale-warning" role="alert">
          <FeatherIcon name="alert-triangle" :size="14" />
          <span>更新失败，当前显示上次成功加载的数据：{{ error }}</span>
          <button type="button" @click="loadHistory(selectedRange)">重试</button>
        </div>
        <!-- Loading -->
        <div v-if="loading && chartData.length === 0" class="chart-state">
          <span class="spinner" />
          <span>加载中...</span>
        </div>

        <!-- Error -->
        <div v-else-if="error && chartData.length === 0" class="chart-state error" role="alert">
          <FeatherIcon name="alert-triangle" :size="24" />
          <span>{{ error }}</span>
          <button class="retry-btn" @click="loadHistory(selectedRange)">重试</button>
        </div>

        <!-- No data -->
        <div v-else-if="chartData.length === 0" class="chart-state">
          <FeatherIcon name="bar-chart-2" :size="48" :stroke-width="1" />
          <span>所选范围内暂无流量数据</span>
        </div>

        <!-- Chart -->
        <div
          v-show="chartData.length > 0"
          ref="chartRef"
          class="chart-canvas"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.traffic-view {
  padding: var(--content-gap);
  height: 100%;
  min-height: 620px;
  overflow: hidden;
}

.traffic-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow: hidden;
}

.traffic-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  flex-shrink: 0;
}

.traffic-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
}

.traffic-title {
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-text-primary);
}

.range-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
}

.range-controls-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wan-select {
  padding: 5px 8px;
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

.custom-range {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-input {
  padding: 5px 8px;
  font-size: 0.75rem;
  font-family: var(--font-mono);
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  outline: none;
  transition: border-color var(--transition-fast);
}

.date-input:focus {
  border-color: var(--color-accent);
}

.date-sep {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.apply-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: 0.78rem;
  font-weight: 500;
  border: 1px solid var(--color-accent-border);
  border-radius: var(--border-radius-sm);
  background: var(--color-accent-subtle);
  color: var(--color-accent);
  cursor: pointer;
  font-family: var(--font-sans);
  transition: all var(--transition-fast);
}

.apply-btn:hover:not(:disabled) {
  background: var(--color-accent);
  color: var(--color-text-inverse);
}

.apply-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.time-btn {
  padding: 5px 14px;
  font-size: 0.78rem;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-family: var(--font-sans);
  white-space: nowrap;
}

.time-btn:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.time-btn.active {
  background: var(--color-accent);
  color: var(--color-text-inverse);
  font-weight: 600;
}

.time-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.traffic-summary {
  display: flex;
  gap: 20px;
  padding: 12px 16px;
  background: var(--color-bg-input);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--color-border-light);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.summary-item.download { color: var(--color-accent); }
.summary-item.upload { color: var(--color-success); }
.summary-item.meta { color: var(--color-text-muted); margin-left: auto; }
.summary-item.coverage {
  width: 100%;
  color: var(--color-warning);
  font-size: 0.72rem;
}

.summary-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  width: 100%;
  color: var(--color-text-muted);
  font-size: 0.68rem;
}

.summary-text {
  display: flex;
  flex-direction: column;
}

.summary-label {
  font-size: 0.65rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.summary-value {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.chart-body {
  flex: 1;
  min-height: 0;
  position: relative;
}

.chart-canvas {
  width: 100%;
  height: 100%;
  min-height: 300px;
}

.chart-state {
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

.chart-state.error {
  color: var(--color-danger);
}

.stale-warning {
  position: absolute;
  top: 4px;
  left: 50%;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: calc(100% - 16px);
  padding: 6px 9px;
  transform: translateX(-50%);
  border: 1px solid color-mix(in srgb, var(--color-warning) 35%, transparent);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-card);
  color: var(--color-warning);
  font-size: 0.72rem;
}

.stale-warning span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stale-warning button {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}

.retry-btn {
  padding: 6px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 0.8rem;
  font-family: var(--font-sans);
  transition: all var(--transition-fast);
}

.retry-btn:hover {
  background: var(--color-bg-hover);
}

/* Spinner — simple CSS animation */
.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--color-border-light);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Portrait adjustments */
@media (max-width: 820px), (max-height: 520px) and (pointer: coarse) {
  .range-controls,
  .range-controls-top {
    width: 100%;
  }

  .range-controls-top {
    flex-wrap: wrap;
  }

  .time-range-switcher {
    width: 100%;
    justify-content: center;
  }

  .time-btn {
    flex: 1;
    padding: 6px 8px;
    font-size: 0.72rem;
  }

  .traffic-summary {
    gap: 12px;
  }
}

@media (max-width: 560px) {
  .custom-range {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    width: 100%;
  }

  .date-input {
    width: 100%;
    min-width: 0;
  }

  .apply-btn {
    grid-column: 1 / -1;
    justify-content: center;
  }
}
</style>
