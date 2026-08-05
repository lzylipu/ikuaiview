<script setup lang="ts">
import { useDashboardStore } from '@/stores/dashboard';
import { storeToRefs } from 'pinia';
import SegmentedProgressBar from '@/components/shared/SegmentedProgressBar.vue';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';

const store = useDashboardStore();
const { stability } = storeToRefs(store);
</script>

<template>
  <div class="card isp-stability">
    <div class="stability-header">
      <div class="stability-title-row">
        <FeatherIcon name="check-circle" :size="16" />
        <span class="stability-title">ISP 性能</span>
      </div>
      <span class="stability-rate">在线率 {{ stability.online_rate.toFixed(1) }}%</span>
    </div>

    <SegmentedProgressBar
      :segments="stability.segments"
      height="14px"
      :animated="true"
    />

    <div class="stability-legend">
      <div class="legend-item">
        <span class="legend-dot" style="background: #22c55e" />
        <span>正常</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot" style="background: #f59e0b" />
        <span>降级</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot" style="background: #6b7280" />
        <span>不可用</span>
      </div>
      <span class="legend-note">最近 {{ stability.window_minutes }} 分钟</span>
    </div>
  </div>
</template>

<style scoped>
.isp-stability {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stability-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stability-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
}

.stability-title {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.stability-rate {
  font-size: 0.85rem;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--color-success);
}

.stability-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.legend-note {
  margin-left: auto;
}
</style>
