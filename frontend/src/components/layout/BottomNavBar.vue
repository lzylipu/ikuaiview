<script setup lang="ts">
import { useNavigation } from '@/composables/useNavigation';
import { RouterLink } from 'vue-router';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';

const iconNameMap: Record<string, string> = {
  grid: 'grid',
  monitor: 'monitor',
  chart: 'bar-chart-2',
  settings: 'settings',
};

function featherName(icon: string): string {
  return iconNameMap[icon] || icon;
}

const { items, activeId } = useNavigation();
</script>

<template>
  <nav class="bottom-nav" aria-label="主导航">
    <RouterLink
      v-for="item in items"
      :key="item.id"
      class="bottom-nav-item"
      :class="{ active: activeId === item.id }"
      :to="item.route"
      :aria-current="activeId === item.id ? 'page' : undefined"
    >
      <FeatherIcon :name="featherName(item.icon)" :size="20" :stroke-width="1.8" />
      <span class="bottom-nav-label">{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.bottom-nav {
  display: flex;
  align-items: center;
  justify-content: space-around;
  width: 100%;
  min-height: calc(var(--bottom-bar-height) + env(safe-area-inset-bottom, 0px));
  background: var(--color-bg-sidebar);
  border-top: 1px solid var(--color-border-light);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.bottom-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 48px;
  height: var(--bottom-bar-height);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 8px;
  font-family: var(--font-sans);
  transition: color var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
  position: relative;
}

.bottom-nav-item:hover {
  color: var(--color-text-secondary);
}

.bottom-nav-item.active {
  color: var(--color-accent);
}

.bottom-nav-item.active::after {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 3px;
  background: var(--color-accent);
  border-radius: 0 0 2px 2px;
}

.bottom-nav-label {
  font-size: 0.6rem;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
</style>
