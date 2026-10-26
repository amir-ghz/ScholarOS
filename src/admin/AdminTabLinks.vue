<script setup lang="ts">
/** A row of links under a page title that move between sibling screens; the current one is `aria-current`. */
defineProps<{ label: string; tabs: { href: string; label: string; current?: boolean; count?: number }[] }>();
</script>

<template>
  <nav class="adm-tablinks" :aria-label="label">
    <a v-for="t in tabs" :key="t.href" :href="t.href" :aria-current="t.current ? 'page' : undefined"
      >{{ t.label }}<span v-if="t.count" class="adm-count">{{ t.count }}</span></a
    >
  </nav>
</template>

<style scoped>
.adm-tablinks {
  display: flex;
  gap: 0.25rem;
  margin-block-end: 1.25rem;
  overflow-x: auto;
  border-bottom: 1px solid var(--app-border);
}
.adm-tablinks a {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.75rem 0.875rem;
  border-bottom: 2px solid transparent;
  color: var(--app-body) !important;
  font-weight: 500;
  white-space: nowrap;
  text-decoration: none !important;
}
.adm-tablinks a:hover {
  color: var(--app-heading) !important;
}
.adm-tablinks a[aria-current='page'] {
  border-bottom-color: var(--p-primary-color);
  color: var(--p-primary-color) !important;
}
.adm-count {
  display: inline-grid;
  place-items: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.375rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
  font-size: 0.6875rem;
  font-weight: 600;
}
</style>
