import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { Device } from '@/types/dashboard';
import DeviceDetail from '@/components/devices/DeviceDetail.vue';
import { useDashboardStore } from '@/stores/dashboard';
import { useAuthStore } from '@/stores/auth';
import {
  reconcileDeviceOverrides,
  useDeviceOverrides,
} from './useDeviceOverrides';

const apiMocks = vi.hoisted(() => ({
  fetchDeviceOverrides: vi.fn(),
  updateDeviceOverride: vi.fn(),
}));

vi.mock('@/api', () => apiMocks);

const device: Device = {
  mac: 'AA:BB:CC:DD:EE:FF',
  hostname: 'workstation',
  ip: '192.168.88.10',
  device_type: 'desktop',
  signal: null,
  connected_duration: 120,
  dhcp_status: 'bound',
  dhcp_expires: null,
  interface: 'bridge',
  arp_status: 'reachable',
};

describe('useDeviceOverrides', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.state = 'authenticated';
    auth.user = {
      username: 'admin', display_name: 'Local administrator', role: 'admin',
      session_kind: 'standard', auth_method: 'password', provider_name: null,
      capabilities: ['read', 'configure', 'manage_devices', 'manage_sessions'],
    };
    apiMocks.fetchDeviceOverrides.mockResolvedValue([]);
    apiMocks.updateDeviceOverride.mockResolvedValue([]);
    await useDeviceOverrides().loadOverrides();
  });

  it('uses overrides carried by the authoritative device snapshot', () => {
    const overrides = useDeviceOverrides();
    const serverDevice = {
      ...device,
      custom_name: 'Office PC',
      custom_type: 'laptop',
    };

    expect(overrides.displayName(serverDevice)).toBe('Office PC');
    expect(overrides.displayType(serverDevice)).toBe('laptop');
    expect(overrides.hasOverride(serverDevice)).toBe(true);
  });

  it('uses a successful save only until the next server device state arrives', async () => {
    const staleDevice = {
      ...device,
      custom_name: 'Old name',
      custom_type: 'camera',
    };
    const overrides = useDeviceOverrides();

    await overrides.saveOverride(device.mac, null, null);

    expect(overrides.displayName(staleDevice)).toBe(device.hostname);
    expect(overrides.displayType(staleDevice)).toBe(device.device_type);
    expect(overrides.hasOverride(staleDevice)).toBe(false);

    const otherSessionDevice = {
      ...device,
      custom_name: 'Changed elsewhere',
      custom_type: 'printer',
    };
    useDashboardStore().handleUpdate({
      system: null,
      gateway: null,
      interfaces: null,
      isp: null,
      traffic: null,
      latency_probes: null,
      wifi: {
        interface_count: 1,
        client_count: 1,
        packet_loss_pct: 0,
        retransmit_pct: 0,
        devices: [otherSessionDevice],
      },
      stability: null,
      interface_statuses: null,
      timestamp: new Date().toISOString(),
      wans: null,
      wans_isp: null,
      wan_traffic_points: null,
    });

    expect(overrides.overrideMap.value.size).toBe(0);
    expect(overrides.displayName(otherSessionDevice)).toBe('Changed elsewhere');
    expect(overrides.displayType(otherSessionDevice)).toBe('printer');
  });

  it('does not recreate pending state when a broadcast beats the PUT response', async () => {
    let finishRequest!: () => void;
    apiMocks.updateDeviceOverride.mockReturnValueOnce(new Promise<void>((resolve) => {
      finishRequest = resolve;
    }));
    const overrides = useDeviceOverrides();
    const saving = overrides.saveOverride(device.mac, 'Office PC', 'desktop');

    reconcileDeviceOverrides();
    finishRequest();
    await saving;

    expect(overrides.overrideMap.value.size).toBe(0);
  });

  it('clears pending state when a complete REST override list arrives', async () => {
    const overrides = useDeviceOverrides();
    await overrides.saveOverride(device.mac, 'Office PC', 'desktop');
    expect(overrides.overrideMap.value.size).toBe(1);

    await overrides.loadOverrides();

    expect(overrides.overrideMap.value.size).toBe(0);
  });

  it('updates the detail panel immediately after a successful edit', async () => {
    const wrapper = mount(DeviceDetail, {
      props: { device, isOverlay: false },
      global: { stubs: { FeatherIcon: true } },
    });

    await wrapper.get('.edit-btn').trigger('click');
    await wrapper.get('#device-edit-name').setValue('Camera Hall');
    await wrapper.get('#device-edit-type').setValue('camera');
    await wrapper.get('.save-btn').trigger('click');
    await flushPromises();

    expect(apiMocks.updateDeviceOverride).toHaveBeenCalledWith(device.mac, {
      custom_name: 'Camera Hall',
      custom_type: 'camera',
    });
    expect(wrapper.get('.detail-hostname').text()).toBe('Camera Hall');
    expect(wrapper.get('.detail-type').text()).toBe('摄像头');
  });
});
