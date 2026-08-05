<script setup lang="ts">
withDefaults(defineProps<{
  connected: boolean;
  label?: string;
}>(), {
  label: 'LIVE',
});
</script>

<template>
  <div class="live-indicator" :class="{ live: connected, dead: !connected }">
    <span class="live-dot" />
    <span class="live-label">{{ connected ? label : 'DOWN' }}</span>
  </div>
</template>

<style scoped>
.live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  font-family: var(--font-mono);
  transition: all var(--transition-fast);
}

.live-indicator.live {
  background: var(--color-success-subtle);
  color: var(--color-success);
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.live-indicator.dead {
  background: var(--color-danger-subtle);
  color: var(--color-danger);
  border: 1px solid rgba(239, 68, 68, 0.15);
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.live .live-dot {
  background: var(--color-success);
  box-shadow: 0 0 6px var(--color-success);
  animation: live-pulse 2s ease-in-out infinite;
}

.dead .live-dot {
  background: var(--color-danger);
}

@keyframes live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
