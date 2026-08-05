/**
 * Shared navigation items and active-route detection.
 * Used by both LeftSidebar (desktop) and BottomNavBar (mobile portrait).
 */
import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  route: string;
}

const ITEMS: NavItem[] = [
  { id: 'overview', label: '概览', icon: 'grid', route: '/' },
];

const ID_BY_ROUTE_NAME: Record<string, string> = {
  dashboard: 'overview',
};

export function useNavigation() {
  const router = useRouter();
  const route = useRoute();
  const auth = useAuthStore();
  const items = computed(() => ITEMS);

  const activeId = computed(() => {
    const name = typeof route.name === 'string' ? route.name : '';
    return ID_BY_ROUTE_NAME[name] || 'overview';
  });

  function navigate(item: NavItem) {
    if (item.route !== route.path) {
      router.push(item.route);
    }
  }

  return {
    items,
    activeId,
    navigate,
  };
}
