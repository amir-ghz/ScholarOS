<script setup lang="ts">
import { vDialog } from '../../dialog';

/**
 * A modal for the content screens: a scrim over the whole admin (above the header and sidebar) and a Conca-style card.
 * The caller passes the dialog's attributes (aria-label or aria-labelledby, @keydown.esc), which land on the
 * `role="dialog"` element with `v-dialog` (focus trap, focus return, description from the first <p>).
 */
defineProps<{ wide?: boolean }>();
</script>

<template>
  <div v-dialog class="cm-scrim" role="dialog" aria-modal="true">
    <div class="cm-box" :class="{ 'is-wide': wide }">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.cm-scrim {
  position: fixed;
  inset: 0;
  z-index: 1050;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(25 24 34 / 0.45);
  backdrop-filter: blur(2px);
}
.cm-box {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: min(560px, 100%);
  max-height: calc(100vh - 2rem);
  max-height: calc(100dvh - 2rem);
  padding: 1.5rem;
  overflow: auto;
  border-radius: var(--app-radius-card);
  background: var(--app-card);
  box-shadow: var(--app-shadow-float);
  color: var(--app-body);
}
.cm-box.is-wide {
  width: min(880px, 100%);
}
.cm-box :deep(h2) {
  margin: 0;
  color: var(--app-heading);
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.35;
}
.cm-box :deep(p) {
  margin: 0;
}
@media (max-width: 575.98px) {
  .cm-box {
    padding: 1.25rem 1rem;
  }
}
</style>
