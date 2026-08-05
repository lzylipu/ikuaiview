<script setup lang="ts">
import { computed } from 'vue';
import feather from 'feather-icons';

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number;
    strokeWidth?: number;
  }>(),
  {
    size: 16,
    strokeWidth: 2,
  },
);

const icon = computed(() => feather.icons[props.name] ?? null);
</script>

<template>
  <span
    v-if="icon"
    class="feather-icon"
    :style="{ display: 'inline-flex', width: size + 'px', height: size + 'px', flexShrink: 0 }"
    v-html="icon.toSvg({ width: size, height: size, 'stroke-width': strokeWidth, color: 'currentColor' })"
  />
</template>

<style>
.feather-icon {
  color: inherit;
}
.feather-icon svg {
  display: block;
}
</style>
