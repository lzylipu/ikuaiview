<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { useDashboardStore } from '@/stores/dashboard';
import { storeToRefs } from 'pinia';
import { useViewport } from '@/composables/useViewport';
import DeviceList from '@/components/devices/DeviceList.vue';
import DeviceDetail from '@/components/devices/DeviceDetail.vue';

const store = useDashboardStore();
const { wifi } = storeToRefs(store);
const { isPortrait } = useViewport();

const devices = computed(() => wifi.value.devices);
const selectedMac = ref<string | null>(null);
const selectedDevice = computed(() =>
  devices.value.find((device) => device.mac === selectedMac.value) ?? null,
);

function selectDevice(mac: string) {
  selectedMac.value = mac;
}

async function clearSelection() {
  const mac = selectedMac.value;
  selectedMac.value = null;
  await nextTick();
  if (!mac) return;
  const trigger = Array.from(
    document.querySelectorAll<HTMLElement>('[data-device-mac]'),
  ).find((element) => element.dataset.deviceMac === mac);
  trigger?.focus();
}

watch(devices, () => {
  if (selectedMac.value && !selectedDevice.value) selectedMac.value = null;
});
</script>

<template>
  <div class="devices-grid" :class="{ portrait: isPortrait }">
    <!-- Device List — left column (landscape) or full width (portrait) -->
    <DeviceList
      :devices="devices"
      :selected-mac="selectedMac"
      @select="selectDevice"
    />

    <!-- Landscape: detail panel in the right column -->
    <DeviceDetail
      v-if="!isPortrait"
      :device="selectedDevice"
      :is-overlay="false"
    />

    <!-- Portrait: full-screen overlay when a device is selected -->
    <Teleport to="body" v-if="isPortrait && selectedDevice">
      <div class="device-overlay">
        <DeviceDetail
          :device="selectedDevice"
          :is-overlay="true"
          @close="clearSelection"
        />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.devices-grid {
  display: grid;
  grid-template-columns: 65% 1fr;
  gap: var(--content-gap);
  padding: var(--content-gap);
  height: 100%;
  min-height: 600px;
  overflow: hidden;
}

.devices-grid.portrait {
  grid-template-columns: 1fr;
}

.device-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: var(--color-bg-primary);
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
