<script setup lang="ts">
import { ref } from 'vue';
import Button from 'primevue/button';
import { api, committed, report, session } from './api';
import type { CommitResult } from './types';
import ContentModal from './ui/content/ContentModal.vue';
import { HIDE_ICON } from './ui/content/pt';

/**
 * `stale`: the draft predates the loaded version; lists the top-level keys that differ (null when not stale).
 * `path`/`version`: the open document, for its History (Postgres mode only).
 */
const props = defineProps<{
  draft: boolean;
  conflict: boolean;
  stale?: string[] | null;
  path?: string;
  version?: string | null;
}>();
const emit = defineEmits<{ restore: []; discard: []; reload: [] }>();

interface Revision {
  id: string;
  version: number;
  created_at: string;
  author: string | null;
  deleted: boolean;
}
const historyOpen = ref(false);
const revisions = ref<Revision[]>([]);
const preview = ref<{ id: string; content: string | null } | null>(null);

async function showHistory() {
  historyOpen.value = true;
  preview.value = null;
  try {
    revisions.value = await api<Revision[]>(`history?path=${encodeURIComponent(props.path ?? '')}`);
  } catch (e) {
    report(e);
  }
}

async function showRevision(id: string) {
  try {
    preview.value = { id, ...(await api<{ content: string | null }>(`history/${id}`)) };
  } catch (e) {
    report(e);
  }
}

/** A 409 means the document changed since it was loaded: the toast says so; reload, then restore again. */
async function restoreRevision(id: string) {
  try {
    committed(await api<CommitResult>(`history/${id}/restore`, { body: { version: props.version ?? null } }));
    historyOpen.value = false;
    emit('reload');
  } catch (e) {
    report(e);
  }
}
</script>

<template>
  <p v-if="session.mode === 'postgres' && path" class="db-history-bar">
    <Button
      icon="pi pi-history"
      label="History"
      severity="secondary"
      outlined
      size="small"
      :pt="HIDE_ICON"
      @click="showHistory"
    />
  </p>
  <ContentModal v-if="historyOpen" wide aria-labelledby="adm-history-title">
    <div class="db-modal-head">
      <span class="stat-icon tint-primary db-modal-icon" aria-hidden="true"><i class="pi pi-history" /></span>
      <h2 id="adm-history-title">History</h2>
    </div>
    <p v-if="revisions.length === 0" class="db-muted">No saved versions yet.</p>
    <ol class="db-history">
      <li v-for="r in revisions" :key="r.id" class="db-rev" :class="{ 'is-shown': preview?.id === r.id }">
        <span class="db-rev-text"
          >{{ new Date(r.created_at).toLocaleString() }} · {{ r.author ?? 'unknown'
          }}<strong v-if="r.deleted" class="db-rev-deleted"> · deleted</strong></span
        >
        <span v-if="!r.deleted" class="db-rev-actions">
          <Button label="Preview" size="small" severity="secondary" text @click="showRevision(r.id)" />
          <Button label="Restore" size="small" severity="secondary" outlined @click="restoreRevision(r.id)" />
        </span>
      </li>
    </ol>
    <pre v-if="preview" class="db-preview" aria-label="Revision preview">{{ preview.content }}</pre>
    <div class="db-modal-actions">
      <Button label="Close" severity="secondary" outlined @click="historyOpen = false" />
    </div>
  </ContentModal>
  <ContentModal v-if="conflict" aria-labelledby="adm-conflict-title">
    <div class="db-modal-head">
      <span class="stat-icon tint-warning db-modal-icon" aria-hidden="true"
        ><i class="pi pi-exclamation-triangle"
      /></span>
      <h2 id="adm-conflict-title">This file changed since you opened it</h2>
    </div>
    <p>
      Someone, or an automated job, saved a newer version. Reload to get it. Your edits stay in this browser, and you
      can re-apply them after reloading.
    </p>
    <div class="db-modal-actions">
      <Button icon="pi pi-refresh" label="Reload" :pt="HIDE_ICON" @click="$emit('reload')" />
    </div>
  </ContentModal>
  <p v-if="draft" class="db-draft" role="status">
    <i class="pi pi-clock db-draft-icon" aria-hidden="true" />
    <span class="db-draft-text">
      You have unsaved edits from an earlier session.
      <strong v-if="stale">
        This draft was made from an older version. Restoring it replaces the newer version, including changes made
        since<template v-if="stale.length">: {{ stale.join(', ') }}</template
        >.
      </strong>
    </span>
    <span class="db-draft-actions">
      <Button label="Restore edits" size="small" @click="$emit('restore')" />
      <Button label="Discard" size="small" severity="secondary" outlined @click="$emit('discard')" />
    </span>
  </p>
</template>

<style scoped>
.db-history-bar {
  display: flex;
  justify-content: flex-end;
  margin: 0;
}
.db-modal-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.db-modal-icon {
  flex: none;
  width: 2.5rem;
  height: 2.5rem;
  margin: 0;
  font-size: 1.0625rem;
}
.db-muted {
  color: var(--app-muted);
  font-size: 0.875rem;
}
.db-history {
  max-height: 50vh;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.db-rev {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  padding: 0.625rem 0.5rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
}
.db-rev + .db-rev {
  border-top: 1px dashed var(--app-border);
}
.db-rev.is-shown {
  background: color-mix(in srgb, var(--p-primary-color) 7%, transparent);
}
.db-rev-text {
  color: var(--app-heading);
  font-variant-numeric: tabular-nums;
}
.db-rev-deleted {
  color: var(--c-danger);
  font-weight: 600;
}
.db-rev-actions {
  display: flex;
  gap: 0.25rem;
}
.db-preview {
  max-height: 40vh;
  margin: 0;
  padding: 1rem;
  overflow: auto;
  border-radius: 0.5rem;
  background: var(--app-canvas);
  color: var(--app-heading);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  white-space: pre-wrap;
}
.db-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.db-draft {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin: 0;
  padding: 0.875rem 1rem;
  border: 1px solid color-mix(in srgb, var(--c-warning) 35%, var(--app-border));
  border-inline-start: 4px solid var(--c-warning);
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--c-warning) 9%, var(--app-card));
  color: var(--app-heading);
  font-size: 0.875rem;
}
.db-draft-icon {
  color: var(--c-warning);
}
.db-draft-text {
  flex: 1 1 18rem;
  min-width: 0;
}
.db-draft-text strong {
  display: block;
  margin-block-start: 0.25rem;
  font-weight: 500;
}
.db-draft-actions {
  display: flex;
  flex: none;
  gap: 0.5rem;
}
</style>
