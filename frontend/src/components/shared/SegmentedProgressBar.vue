<script setup lang="ts">
import { computed } from 'vue';

interface Segment {
  color: string;
  value: number;
  label?: string | null;
}

const props = withDefaults(defineProps<{
  segments: Segment[];
  height?: string;
  animated?: boolean;
  showLabels?: boolean;
}>(), {
  height: '12px',
  animated: true,
  showLabels: false,
});

const total = computed(() => props.segments.reduce((s, seg) => s + seg.value, 0));

const normalized = computed(() =>
  props.segments.map((seg) => ({
    ...seg,
    widthPct: total.value > 0 ? (seg.value / total.value) * 100 : 0,
  }))
);
</script>

<template>
  <div class="segmented-bar" :style="{ height }">
    <div
      v-for="(seg, i) in normalized"
      :key="i"
      class="segmented-bar__segment"
      :class="{ 'segmented-bar__segment--animated': animated }"
      :style="{
        width: seg.widthPct + '%',
        backgroundColor: seg.color,
      }"
    >
      <span v-if="showLabels && seg.label && seg.widthPct > 10" class="segmented-bar__label">
        {{ seg.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.segmented-bar {
  display: flex;
  width: 100%;
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-bg-input);
  border: 1px solid var(--color-border-light);
}

.segmented-bar__segment {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1);
}

.segmented-bar__segment--animated {
  transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1);
}

.segmented-bar__label {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-inverse);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 4px;
}
</style>
