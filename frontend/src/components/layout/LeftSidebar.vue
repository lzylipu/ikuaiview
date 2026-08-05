<script setup lang="ts">
import { useNavigation } from '@/composables/useNavigation';
import { computed } from 'vue';
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

// Settings lives in the bottom gear slot, not in the main nav strip
const navItems = computed(() => items.value.filter(i => i.id !== 'settings'));
const hasSettings = computed(() => items.value.some(i => i.id === 'settings'));
</script>

<template>
  <nav class="sidebar-nav" aria-label="主导航">
    <RouterLink
      v-for="item in navItems"
      :key="item.id"
      class="nav-item"
      :class="{ active: activeId === item.id }"
      :to="item.route"
      :aria-current="activeId === item.id ? 'page' : undefined"
      :title="item.label"
    >

      <FeatherIcon :name="featherName(item.icon)" :size="22" :stroke-width="1.8" />

      <span class="nav-label">{{ item.label }}</span>
    </RouterLink>
  </nav>

  <!-- Settings gear at bottom -->
  <div v-if="hasSettings" class="sidebar-bottom">
    <RouterLink
      class="settings-btn"
      :class="{ active: activeId === 'settings' }"
      title="设置"
      to="/settings"
      :aria-current="activeId === 'settings' ? 'page' : undefined"
    >
      <FeatherIcon name="settings" :size="20" :stroke-width="1.8" />
    </RouterLink>
  </div>
</template>

<style scoped>
.nav-item {
  width: 44px;
  height: 44px;
  aspect-ratio: 1;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  color: var(--color-text-muted);
  transition: all var(--transition-fast);
  position: relative;
  border: 1px solid transparent;
}

.nav-item:hover {
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
}

.nav-item.active {
  color: var(--color-accent);
  background: var(--color-accent-subtle);
  border-color: var(--color-accent-border);
}

/* Active left border highlight */
.nav-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 50%;
  background: var(--color-accent);
  border-radius: 0 2px 2px 0;
}

.nav-label {
  font-size: 0.6rem;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.settings-btn {
  width: 40px;
  height: 40px;
  aspect-ratio: 1;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: var(--border-radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  position: relative;
}

.settings-btn:hover {
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
}

.settings-btn.active {
  color: var(--color-accent);
  background: var(--color-accent-subtle);
  border-color: var(--color-accent-border);
}

.settings-btn.active::before {
  content: '';
  position: absolute;
  left: -4px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 50%;
  background: var(--color-accent);
  border-radius: 0 2px 2px 0;
}
</style>
