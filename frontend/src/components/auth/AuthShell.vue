<script setup lang="ts">
import FeatherIcon from '@/components/shared/FeatherIcon.vue';

defineProps<{
  title: string;
  subtitle: string;
  icon?: string;
}>();
</script>

<template>
  <main class="auth-page">
    <section class="auth-panel" :aria-labelledby="`${title}-title`">
      <header class="auth-header">
        <div class="auth-brand">
          <FeatherIcon name="wifi" :size="24" :stroke-width="1.6" />
          <span>iKuaiView</span>
        </div>
        <div class="auth-title-icon" aria-hidden="true">
          <FeatherIcon :name="icon || 'shield'" :size="22" />
        </div>
        <h1 :id="`${title}-title`">{{ title }}</h1>
        <p>{{ subtitle }}</p>
      </header>
      <slot />
      <footer v-if="$slots.footer" class="auth-footer">
        <slot name="footer" />
      </footer>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  width: 100%;
  height: 100dvh;
  min-height: 0;
  display: grid;
  align-items: safe center;
  justify-items: center;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  background: var(--color-bg-primary);
}

.auth-panel {
  width: min(100%, 420px);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-md);
  padding: 28px;
}

.auth-header {
  margin-bottom: 24px;
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent);
  font-weight: 700;
  margin-bottom: 28px;
}

.auth-title-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: var(--border-radius-sm);
  color: var(--color-accent);
  background: var(--color-accent-subtle);
  margin-bottom: 14px;
}

h1 {
  font-size: 1.35rem;
  margin-bottom: 8px;
}

p {
  color: var(--color-text-secondary);
  font-size: 0.86rem;
  line-height: 1.65;
}

.auth-footer {
  border-top: 1px solid var(--color-border-light);
  padding-top: 18px;
  margin-top: 22px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.auth-footer :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.auth-footer :deep(a:hover),
.auth-footer :deep(a:focus-visible) {
  color: var(--color-text-primary);
}

.auth-footer :deep(a:focus-visible) {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
  border-radius: 2px;
}

@media (max-width: 480px) {
  .auth-page {
    place-items: start center;
    padding-top: max(18px, env(safe-area-inset-top));
  }

  .auth-panel {
    padding: 22px 18px;
  }
}

@media (max-height: 520px) and (min-width: 600px) {
  .auth-page {
    place-items: start center;
    padding-top: max(12px, env(safe-area-inset-top));
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }

  .auth-panel {
    width: min(100%, 520px);
    padding: 16px 24px;
  }

  .auth-header {
    margin-bottom: 12px;
  }

  .auth-brand {
    margin-bottom: 8px;
  }

  .auth-title-icon {
    display: none;
  }

  h1 {
    font-size: 1.1rem;
    margin-bottom: 3px;
  }

  p {
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .auth-footer {
    padding-top: 8px;
    margin-top: 10px;
  }
}
</style>
