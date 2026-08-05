<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MainLayout from '@/components/layout/MainLayout.vue';
import { useWebSocketStore } from '@/stores/websocket';
import { useAuthStore } from '@/stores/auth';
import { useDeviceOverrides } from '@/composables/useDeviceOverrides';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const wsStore = useWebSocketStore();
const { loadOverrides } = useDeviceOverrides();

const isFullScreen = computed(() => !!route.meta.fullScreen);
let applicationStarted = false;
let applicationStarting = false;
let applicationGeneration = 0;
let applicationMounted = false;

async function startApplication(): Promise<void> {
  if (!applicationMounted || applicationStarted || applicationStarting || !auth.authenticated) {
    return;
  }
  const generation = applicationGeneration;
  applicationStarting = true;
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsStore.connect(`${protocol}//${window.location.host}/ws`);
    applicationStarted = true;
    await loadOverrides();
  } finally {
    applicationStarting = false;
    if (
      generation !== applicationGeneration
      && applicationMounted
      && auth.authenticated
      && !applicationStarted
    ) {
      void startApplication();
    }
  }
}

function stopApplication(): void {
  applicationGeneration++;
  if (!applicationStarted) return;
  applicationStarted = false;
  wsStore.disconnect();
}

watch(
  () => auth.authenticated,
  async (authenticated, wasAuthenticated) => {
    if (authenticated) {
      await startApplication();
      return;
    }
    stopApplication();
    if (wasAuthenticated && route.meta.requiresAuth) {
      await router.replace({ name: 'login', query: { redirect: route.fullPath } });
    }
  },
);

watch(
  () => wsStore.sessionExpired,
  (expired) => {
    if (expired) auth.expireFromWebSocket();
  },
);

watch(
  () => route.name,
  () => {
    if (auth.authenticated) void startApplication();
  },
);

onMounted(async () => {
  applicationMounted = true;
  auth.startUnauthorizedListener();
  if (route.name !== 'oidc-complete' || route.meta.oidcCompletion !== true) {
    await auth.initialize().catch(() => undefined);
  }
  await startApplication();
});

onUnmounted(() => {
  applicationMounted = false;
  stopApplication();
  auth.stopUnauthorizedListener();
});
</script>

<template>
  <MainLayout v-if="!isFullScreen">
    <router-view />
  </MainLayout>
  <router-view v-else />
</template>
