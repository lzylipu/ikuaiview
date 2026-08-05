<script setup lang="ts">
import FeatherIcon from '@/components/shared/FeatherIcon.vue';

const props = withDefaults(defineProps<{
  downloadBps: number;
  uploadBps: number;
}>(), {
  downloadBps: 0,
  uploadBps: 0,
});

function formatValue(bps: number): string {
  if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1);
  return (bps / 1_000).toFixed(1);
}

function formatUnit(bps: number): string {
  if (bps >= 1_000_000) return 'Mbps';
  return 'Kbps';
}
</script>

<template>
  <div class="rate-display">
    <div class="rate-item download">
      <FeatherIcon name="download" :size="14" :stroke-width="2.5" />
      <span class="rate-value">{{ formatValue(downloadBps) }}</span>
      <span class="rate-unit">{{ formatUnit(downloadBps) }}</span>
    </div>
    <div class="rate-item upload">
      <FeatherIcon name="upload" :size="14" :stroke-width="2.5" />
      <span class="rate-value">{{ formatValue(uploadBps) }}</span>
      <span class="rate-unit">{{ formatUnit(uploadBps) }}</span>
    </div>
  </div>
</template>

<style scoped>
.rate-display {
  display: flex;
  justify-content: space-evenly;
}

.rate-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.download {
  color: var(--color-success);
}

.upload {
  color: var(--color-accent);
}

.rate-value {
  font-weight: 600;
  font-size: 1rem;
}

.rate-unit {
  font-size: 0.7rem;
}
</style>
