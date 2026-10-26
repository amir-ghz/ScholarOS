<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * A long settings screen as tabs, one section shown at a time, the open one in the URL hash. On load an unknown hash
 * opens the first section; later, a hash naming no section (the skip link's #adm-main) leaves the open one.
 * `fields`: the error-key prefixes a section owns; a section with a save error shows a dot, and a new error key opens
 * its section (a save or reload of another document replaces the errors but keeps older ones: no jump).
 * Each section's content is the slot named by its id. `icon`: a PrimeIcons name (e.g. `pi-cog`) shown before the label.
 * At 1200px and wider the sections are a card-style list beside the open one; narrower, a sideways-scrolling tab row.
 */
const props = defineProps<{
  sections: { id: string; label: string; fields?: string[]; icon?: string }[];
  errors?: Record<string, string>;
}>();
const active = defineModel<string>({ default: '' });
const list = ref<HTMLElement | null>(null);

type Section = (typeof props.sections)[number];
const owns = (s: Section, key: string) => !!s.fields?.some((p) => key.startsWith(p));
function hasError(s: Section) {
  return Object.keys(props.errors ?? {}).some((k) => owns(s, k));
}
const fromHash = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (props.sections.some((s) => s.id === id)) active.value = id;
};
function open(id: string, focus = false) {
  if (id !== active.value) location.hash = id; // a history entry, so Back returns to the previous section
  if (focus) list.value?.querySelector<HTMLElement>(`#adm-tab-${id}`)?.focus();
}
function onKey(e: KeyboardEvent) {
  const rtl = getComputedStyle(list.value!).direction === 'rtl';
  const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
  const at = props.sections.findIndex((s) => s.id === active.value);
  const n = props.sections.length;
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : step ? (at + step + n) % n : -1;
  if (to < 0) return;
  e.preventDefault();
  open(props.sections[to].id, true);
}

watch(
  () => Object.keys(props.errors ?? {}),
  (keys, before) => {
    const added = keys.filter((k) => !before.includes(k));
    const shown = props.sections.find((s) => s.id === active.value);
    const first = props.sections.find((s) => added.some((k) => owns(s, k)));
    if (first && !(shown && added.some((k) => owns(shown, k)))) open(first.id);
  },
);
// On the narrow tab row, keep the open tab in view.
watch(active, (id) =>
  nextTick(() => list.value?.querySelector(`#adm-tab-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })),
);
onMounted(() => {
  // One write: under a parent's v-model, `active` reads the old value until the parent re-renders.
  const id = decodeURIComponent(location.hash.slice(1));
  active.value = props.sections.some((s) => s.id === id) ? id : active.value || props.sections[0].id;
  addEventListener('hashchange', fromHash);
});
onBeforeUnmount(() => removeEventListener('hashchange', fromHash));
</script>

<template>
  <div class="sec">
    <div ref="list" class="sec-nav card" role="tablist" aria-label="Sections" @keydown="onKey">
      <button
        v-for="s in sections"
        :id="`adm-tab-${s.id}`"
        :key="s.id"
        type="button"
        role="tab"
        class="sec-tab"
        :aria-selected="s.id === active"
        :aria-controls="`adm-panel-${s.id}`"
        :tabindex="s.id === active ? 0 : -1"
        @click="open(s.id)"
      >
        <i v-if="s.icon" :class="['pi', s.icon]" aria-hidden="true" />
        <span class="sec-label">{{ s.label }}</span
        ><span v-if="hasError(s)" class="sec-error"><span class="adm-visually-hidden">(has errors)</span></span>
      </button>
    </div>
    <div
      v-if="active"
      :id="`adm-panel-${active}`"
      class="sec-panel"
      role="tabpanel"
      :aria-labelledby="`adm-tab-${active}`"
    >
      <slot :name="active" />
    </div>
  </div>
</template>

<style scoped>
/* Narrow: a sideways-scrolling tab row in a card, the open tab underlined (Conca's profile tabs). */
.sec {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.sec-nav {
  display: flex;
  gap: 0.25rem;
  padding: 0 0.75rem;
  overflow-x: auto;
  scroll-padding-inline: 1rem;
  scrollbar-width: none;
}
.sec-tab {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.5rem;
  min-height: 3.25rem;
  padding: 0 0.875rem;
  border: 0;
  background: none;
  color: var(--app-body);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s;
}
.sec-tab::after {
  content: '';
  position: absolute;
  inset-inline: 0.5rem;
  inset-block-end: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: transparent;
}
.sec-tab:hover {
  color: var(--app-heading);
}
.sec-tab[aria-selected='true'] {
  color: var(--p-primary-color);
}
.sec-tab[aria-selected='true']::after {
  background: var(--p-primary-color);
}
.sec-tab:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
  border-radius: 0.5rem;
}
.sec-tab > .pi {
  font-size: 1rem;
}
.sec-error {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--c-danger);
}
.sec-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-width: 0;
}

/* Wide: a sticky card of sections beside the open one (Conca's account settings). */
@media (min-width: 1200px) {
  .sec {
    display: grid;
    grid-template-columns: 16rem minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }
  .sec-nav {
    position: sticky;
    inset-block-start: calc(var(--app-header-height) + 1.5rem);
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.75rem;
    overflow: visible;
  }
  .sec-tab {
    min-height: 0;
    padding: 0.75rem 0.875rem;
    border-radius: 0.5rem;
    white-space: normal;
    text-align: start;
  }
  .sec-tab::after {
    display: none;
  }
  .sec-tab + .sec-tab::before {
    content: '';
    position: absolute;
    inset-inline: 0.875rem;
    inset-block-start: -0.0625rem;
    border-top: 1px solid var(--app-border);
  }
  .sec-tab:hover {
    background: var(--app-menu-hover);
  }
  .sec-tab[aria-selected='true'] {
    background: color-mix(in srgb, var(--p-primary-color) 10%, transparent);
  }
  .sec-tab[aria-selected='true']::before,
  .sec-tab[aria-selected='true'] + .sec-tab::before,
  .sec-tab:hover::before,
  .sec-tab:hover + .sec-tab::before {
    border-color: transparent;
  }
  .sec-label {
    flex: 1;
  }
}
</style>
