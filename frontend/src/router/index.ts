import { createRouter, createWebHistory } from 'vue-router';
import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router';
import { fetchFullConfig } from '@/api';
import type { Capability } from '@/api';
import { useAuthStore } from '@/stores/auth';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { title: '网络概况', requiresAuth: true, requiresWizard: true },
  },
  {
    path: '/wizard',
    name: 'wizard',
    component: () => import('@/views/WizardView.vue'),
    meta: { title: '初始配置', fullScreen: true, requiresAuth: true, capability: 'configure' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', fullScreen: true, guestOnly: true },
  },
  {
    path: '/login/oidc/complete',
    name: 'oidc-complete',
    component: () => import('@/views/OidcCompleteView.vue'),
    meta: { title: '完成登录', fullScreen: true, oidcCompletion: true },
  },
  {
    path: '/pair',
    name: 'pair',
    component: () => import('@/views/PairView.vue'),
    meta: { title: '设备配对', fullScreen: true, guestOnly: true },
  },
  {
    path: '/setup-required',
    name: 'setup-required',
    component: () => import('@/views/SetupRequiredView.vue'),
    meta: { title: '需要初始设置', fullScreen: true },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

export async function authNavigationGuard(to: RouteLocationNormalized) {
  const isOidcCompletion = to.name === 'oidc-complete' && to.meta.oidcCompletion === true;
  if (isOidcCompletion && to.query.error === undefined) return true;

  const auth = useAuthStore();
  try {
    await auth.initialize();
  } catch {
    if (to.name !== 'login') return { name: 'login', query: { redirect: to.fullPath } };
  }

  if (auth.setupRequired) {
    return to.name === 'setup-required' ? true : { name: 'setup-required' };
  }
  if (isOidcCompletion) return true;
  if (to.name === 'setup-required') {
    return auth.authenticated ? { name: 'dashboard' } : { name: 'login' };
  }
  if (to.meta.guestOnly && auth.authenticated) return { name: 'dashboard' };
  if (to.meta.requiresAuth && !auth.authenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  const capability = to.meta.capability as Capability | undefined;
  if (capability && !auth.can(capability)) return { name: 'dashboard' };

  if (to.meta.requiresWizard && auth.authenticated) {
    try {
      const config = await fetchFullConfig();
      if (!config.wizard_completed && auth.can('configure')) return { name: 'wizard' };
    } catch {
      // The destination remains useful for showing the backend connection state.
    }
  }
  return true;
}

router.beforeEach(authNavigationGuard);
