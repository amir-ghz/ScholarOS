<script setup lang="ts">
/**
 * The Reading screens' sibling links (Today, Library, Notebooks, Vault, Settings) as a tab strip in a card, the way
 * Conca's profile pages put their sections under the header. A row of links, not tabs: the current one is
 * `aria-current="page"`.
 */
const props = defineProps<{
  base: string;
  current: 'today' | 'library' | 'notebooks' | 'vault' | 'settings';
}>();
const LINKS = [
  { id: 'today', path: 'reading', label: 'Today', icon: 'pi-sun' },
  { id: 'library', path: 'reading/library', label: 'Library', icon: 'pi-bookmark' },
  { id: 'notebooks', path: 'reading/notebooks', label: 'Notebooks', icon: 'pi-file-edit' },
  { id: 'vault', path: 'reading/vault', label: 'Vault', icon: 'pi-database' },
  { id: 'settings', path: 'reading/settings', label: 'Settings', icon: 'pi-sliders-h' },
] as const;
const href = (path: string) => `${props.base}/${path}`;
</script>

<template>
  <nav class="card reading-nav" aria-label="Reading">
    <a
      v-for="l in LINKS"
      :key="l.id"
      :href="href(l.path)"
      :aria-current="current === l.id ? 'page' : undefined"
      class="reading-nav-link"
    >
      <i :class="['pi', l.icon]" aria-hidden="true" />{{ l.label }}
    </a>
  </nav>
</template>

<style scoped>
.reading-nav {
  display: flex;
  gap: 0.25rem;
  margin-block-end: 1.25rem;
  padding: 0 1rem;
  overflow-x: auto;
  scrollbar-width: none;
}
.reading-nav-link {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.5rem;
  padding: 0.95rem 0.875rem 0.8rem;
  border-block-end: 2px solid transparent;
  color: var(--app-body);
  font-size: 0.9375rem;
  font-weight: 500;
  text-decoration: none !important;
  transition:
    color 0.15s,
    border-color 0.15s;
}
.reading-nav-link .pi {
  font-size: 0.95rem;
  color: var(--app-muted);
}
.reading-nav-link:hover {
  color: var(--app-heading);
}
.reading-nav-link:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -4px;
  border-radius: 0.5rem;
}
.reading-nav-link[aria-current='page'] {
  border-block-end-color: var(--p-primary-color);
  color: var(--p-primary-color);
}
.reading-nav-link[aria-current='page'] .pi {
  color: inherit;
}
@media (max-width: 575.98px) {
  .reading-nav {
    padding: 0 0.5rem;
  }
  .reading-nav-link {
    padding-inline: 0.625rem;
  }
}
</style>
