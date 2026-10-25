<script setup lang="ts">
import Button from 'primevue/button';
import { visible } from '../../career';
import { formatDate } from '../../dates';
import { SOURCE_NAMES, authorsLine } from '../../reading';
import { sourceTint } from './sources';
import type { DigestItem } from '../../../lib/reading/types';

/**
 * One paper of the digest: title (to its reading room), source chip, authors, date and the link to the source, the
 * digest's line, then Save and Dismiss. `rowKey` is the row's `data-row`, which Today's focus moves look up; Dismiss
 * keeps the `adm-reading-dismiss` class they focus. Third-party text is shown with {{ }} only.
 */
defineProps<{ item: DigestItem; href: string; rowKey: string; rank?: number }>();
defineEmits<{ save: []; dismiss: [] }>();
</script>

<template>
  <li :data-row="rowKey" class="digest-row">
    <span v-if="rank" class="digest-rank" aria-hidden="true">{{ rank }}</span>
    <div class="digest-main">
      <a class="digest-title" :href="href" dir="auto">{{ visible(item.paper.title) }}</a>
      <p class="digest-meta">
        <span :class="['chip', `chip-${sourceTint(item.paper.source)}`]">{{
          SOURCE_NAMES[item.paper.source] ?? item.paper.source
        }}</span>
        <span v-if="item.paper.authors.length" dir="auto">{{ authorsLine(item.paper.authors) }}</span>
        <template v-if="item.paper.publishedAt">
          <span aria-hidden="true">·</span
          ><time :datetime="item.paper.publishedAt">{{ formatDate(item.paper.publishedAt) }}</time>
        </template>
        <span aria-hidden="true">·</span>
        <a :href="item.paper.url" target="_blank" rel="noopener noreferrer" class="digest-source"
          >Source <i class="pi pi-arrow-up-right" aria-hidden="true"
        /></a>
      </p>
      <p class="digest-line" dir="auto">{{ visible(item.line) }}</p>
    </div>
    <div class="digest-actions">
      <Button
        size="small"
        :icon="item.paper.state === 'saved' ? 'pi pi-bookmark-fill' : 'pi pi-bookmark'"
        :label="item.paper.state === 'saved' ? 'Saved' : 'Save'"
        :severity="item.paper.state === 'saved' ? undefined : 'secondary'"
        :outlined="item.paper.state !== 'saved'"
        :aria-pressed="item.paper.state === 'saved'"
        @click="$emit('save')"
      />
      <Button
        class="adm-reading-dismiss"
        size="small"
        severity="secondary"
        text
        icon="pi pi-times"
        label="Dismiss"
        @click="$emit('dismiss')"
      />
    </div>
  </li>
</template>

<style scoped>
.digest-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.25rem 1rem;
  padding: 1rem 1.5rem;
}
.digest-row + .digest-row {
  border-top: 1px dashed var(--app-border);
}
.digest-rank {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--c-primary) 12%, transparent);
  color: var(--c-primary);
  font-size: 0.8125rem;
  font-weight: 700;
}
.digest-row:not(:has(.digest-rank)) .digest-main {
  grid-column: 1 / 3;
}
.digest-title {
  color: var(--app-heading);
  font-size: 0.9875rem;
  font-weight: 600;
  line-height: 1.4;
  text-decoration: none;
}
.digest-title:hover {
  color: var(--p-primary-color);
}
.digest-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
  margin: 0.375rem 0 0;
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.digest-source {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 500;
}
.digest-source .pi {
  font-size: 0.6875rem;
}
.digest-line {
  margin: 0.5rem 0 0;
  color: var(--app-body);
  font-size: 0.875rem;
  line-height: 1.55;
}
.digest-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.375rem;
}
/* A narrow list (a side column, a phone): the actions go under the text. */
@container (max-width: 560px) {
  .digest-row {
    grid-template-columns: auto minmax(0, 1fr);
    padding-inline: 1rem;
  }
  .digest-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
    margin-block-start: 0.375rem;
  }
  .digest-row:has(.digest-rank) .digest-actions {
    grid-column: 2;
  }
  .digest-row:not(:has(.digest-rank)) .digest-main {
    grid-column: 1 / -1;
  }
}
</style>
