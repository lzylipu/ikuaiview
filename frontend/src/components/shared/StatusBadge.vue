<script setup lang="ts">
defineProps<{
  status: 'online' | 'offline' | 'degraded';
  pulse?: boolean;
}>();

const labelMap: Record<string, string> = {
  online: '在线',
  offline: '离线',
  degraded: '降级',
};
</script>

<template>
  <span class="status-badge" :class="[status, { pulse: pulse && status === 'online' }]">
    <span class="status-dot" />
    <span class="status-label">{{ labelMap[status] || status }}</span>
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8rem;
  font-weight: 500;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.online .status-dot {
  background: var(--color-success);
}

.offline .status-dot {
  background: var(--color-danger);
}

.degraded .status-dot {
  background: var(--color-warning);
}

.pulse .status-dot {
  animation: status-pulse 2s ease-in-out infinite;
}

@keyframes status-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
}
</style>
