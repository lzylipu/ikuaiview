/// <reference types="vite/client" />

import 'vue-router';
import type { Capability } from '@/api';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    fullScreen?: boolean;
    requiresAuth?: boolean;
    requiresWizard?: boolean;
    guestOnly?: boolean;
    oidcCompletion?: boolean;
    capability?: Capability;
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_WS_URL: string;
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
