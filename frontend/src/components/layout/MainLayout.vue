<script setup lang="ts">
import { computed } from 'vue';
import TopNavbar from './TopNavbar.vue';
import LeftSidebar from './LeftSidebar.vue';
import BottomNavBar from './BottomNavBar.vue';
import { useViewport } from '@/composables/useViewport';

const { isPortrait } = useViewport();

const shellClass = computed(() => ({
  'app-shell': true,
  'has-bottom-bar': isPortrait.value,
}));
</script>

<template>
  <div :class="shellClass">
    <!-- Sidebar: landscape / wide screens -->
    <aside v-if="!isPortrait" class="app-sidebar" aria-label="应用导航">
      <LeftSidebar />
    </aside>

    <header class="app-navbar">
      <TopNavbar />
    </header>

    <!-- Bottom bar: portrait / narrow screens -->
    <footer v-if="isPortrait" class="app-bottom-bar">
      <BottomNavBar />
    </footer>

    <main class="app-content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
/* Layout handled by layout.css — this component is the shell */
</style>
