<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Skeleton from 'primevue/skeleton';
import AdminShell from './AdminShell.vue';
import ReadingNav from './ui/reading/ReadingNav.vue';
import { KIND_LOOK } from './ui/reading/sources';
import { api, report } from './api';
import { visible } from './career';
import { relativeTime } from './dates';
import { KIND_NAMES } from './vault';
import type { AdminCtx } from './types';
import type { NoteKind, NoteRow } from '../lib/reading/types';

// Titles may come from a paper's title: shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const open = (id: number) => `${base}/reading/vault/${id}`;

const notes = ref<NoteRow[] | null>(null);
const q = ref('');
const kind = ref<NoteKind | ''>('');
/** the filters the shown list answers */
const shown = ref({ q: '', kind: '' as NoteKind | '' });

async function load() {
  const want = { q: q.value.trim(), kind: kind.value };
  const query = new URLSearchParams(Object.entries(want).filter(([, v]) => v));
  try {
    const res = await api<{ notes: NoteRow[] }>(`reading/vault/notes?${query}`);
    if (want.q !== q.value.trim() || want.kind !== kind.value) return; // a later search's answer wins
    notes.value = res.notes;
    shown.value = want;
  } catch (e) {
    report(e);
  }
}
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 300);
});
watch(kind, load);

const KINDS: { label: string; value: NoteKind | '' }[] = [
  { label: 'All notes', value: '' },
  { label: 'Papers', value: 'paper' },
  { label: 'Chats', value: 'chat' },
  { label: 'Notes', value: 'free' },
];
const PLURAL = { paper: 'papers', chat: 'chats', free: 'notes' } as const;

const title = ref('');
const creating = ref(false);
const createError = ref('');
async function create() {
  creating.value = true;
  try {
    const { id } = await api<{ id: number }>('reading/vault/notes', { body: { title: title.value.trim() } });
    location.href = open(id);
  } catch (e) {
    createError.value = (e as Error).message;
    creating.value = false;
  }
}

const exporting = ref(false);
const exportError = ref('');
/** The zip as a download; the server's sentence (too big, unreachable) in place. */
async function exportZip() {
  exporting.value = true;
  exportError.value = '';
  try {
    const res = await fetch('/api/admin/reading/vault/export');
    if (!res.ok) {
      const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
      throw new Error(data?.error ?? res.statusText);
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'vault.zip';
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    exportError.value = (e as Error).message;
  } finally {
    exporting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/vault" title="Vault">
    <ReadingNav :base="base" current="vault" />

    <div class="rd-vault">
      <section class="card card-flush" aria-labelledby="rd-notes-head">
        <div class="card-head">
          <div>
            <h2 id="rd-notes-head" class="card-title">
              <i class="pi pi-database text-primary" aria-hidden="true" /> Notes
            </h2>
            <p class="card-subtitle">Linked Markdown notes on what you read, in Obsidian’s format.</p>
          </div>
          <Button
            as="a"
            :href="`${base}/reading/vault/graph`"
            label="Graph"
            icon="pi pi-share-alt"
            severity="secondary"
            outlined
            size="small"
          />
        </div>
        <div class="rd-filters">
          <div class="rd-search">
            <label for="rd-vault-q" class="adm-visually-hidden">Search notes</label>
            <i class="pi pi-search" aria-hidden="true" />
            <InputText
              id="rd-vault-q"
              v-model="q"
              type="search"
              maxlength="200"
              autocomplete="off"
              placeholder="Search notes"
              fluid
            />
          </div>
          <div class="rd-kind" role="group" aria-labelledby="rd-vault-kind">
            <span id="rd-vault-kind" class="adm-visually-hidden">Kind</span>
            <button
              v-for="k in KINDS"
              :key="k.value"
              type="button"
              :class="['rd-kind-chip', { 'is-on': kind === k.value }]"
              :aria-pressed="kind === k.value"
              @click="kind = k.value"
            >
              <i v-if="k.value" :class="['pi', KIND_LOOK[k.value].icon]" aria-hidden="true" />{{ k.label }}
            </button>
          </div>
        </div>

        <div v-if="!notes" class="p-6">
          <p class="adm-visually-hidden">Loading…</p>
          <Skeleton v-for="n in 4" :key="n" height="3rem" class="mb-3" />
        </div>
        <div v-else-if="!notes.length" class="empty-state">
          <i :class="['pi', shown.q ? 'pi-search' : 'pi-database']" aria-hidden="true" />
          <p v-if="shown.q">No notes match “{{ shown.q }}”.</p>
          <p v-else-if="shown.kind">No {{ PLURAL[shown.kind] }} yet.</p>
          <p v-else>
            No notes yet. Saving a paper, highlighting it or writing a note on it adds its note here, and so does saving
            a chat answer. Or start a note of your own.
          </p>
        </div>
        <ul v-else class="rd-notes">
          <li v-for="n in notes" :key="n.id">
            <span :class="['rd-kind-icon', `tint-${KIND_LOOK[n.kind].tint}`]" aria-hidden="true"
              ><i :class="['pi', KIND_LOOK[n.kind].icon]"
            /></span>
            <span class="rd-note-main">
              <a :href="open(n.id)" dir="auto">{{ visible(n.title) }}</a>
              <span class="rd-note-sub">{{ KIND_NAMES[n.kind] }} · updated {{ relativeTime(n.updatedAt) }}</span>
            </span>
            <i class="pi pi-angle-right rd-note-go" aria-hidden="true" />
          </li>
        </ul>
      </section>

      <div class="rd-vault-side">
        <section class="card" aria-labelledby="rd-new-note-head">
          <h2 id="rd-new-note-head" class="card-title">
            <span class="rd-side-icon tint-success" aria-hidden="true"><i class="pi pi-plus" /></span> New note
          </h2>
          <form class="rd-form" @submit.prevent="create">
            <label for="adm-vault-title">Title</label>
            <InputText
              id="adm-vault-title"
              v-model="title"
              type="text"
              maxlength="200"
              fluid
              :invalid="!!createError"
              :aria-invalid="!!createError || undefined"
              :aria-describedby="createError ? 'adm-vault-error' : undefined"
              @input="createError = ''"
            />
            <span v-if="createError" id="adm-vault-error" class="rd-error" role="alert">{{ createError }}</span>
            <Button
              type="submit"
              icon="pi pi-plus"
              :label="creating ? 'Creating…' : 'Create'"
              :disabled="creating || !title.trim()"
            />
          </form>
        </section>

        <section class="card" aria-labelledby="rd-export-head">
          <h2 id="rd-export-head" class="card-title">
            <span class="rd-side-icon tint-info" aria-hidden="true"><i class="pi pi-download" /></span> Export
          </h2>
          <div class="rd-form">
            <small id="adm-vault-export-hint">
              One Markdown file per note in papers/, notes/ and chats/, which Obsidian opens as a vault. It holds your
              notes, highlights and summaries, never a paper’s full text.
            </small>
            <Button
              icon="pi pi-download"
              severity="secondary"
              outlined
              :label="exporting ? 'Exporting…' : 'Export as a zip'"
              :disabled="exporting"
              aria-describedby="adm-vault-export-hint"
              @click="exportZip"
            />
            <span v-if="exportError" class="rd-error" role="alert">{{ exportError }}</span>
          </div>
        </section>
      </div>
    </div>
  </AdminShell>
</template>

<style scoped>
.rd-vault {
  display: grid;
  gap: 1rem;
  align-items: start;
}
@media (min-width: 1200px) {
  .rd-vault {
    grid-template-columns: minmax(0, 1fr) 340px;
  }
}
.rd-vault-side {
  display: grid;
  gap: 1rem;
}
.rd-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--app-border);
}
.rd-search {
  position: relative;
  flex: 1 1 16rem;
}
.rd-search > .pi {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 0.875rem;
  z-index: 1;
  color: var(--app-muted);
  font-size: 0.875rem;
  transform: translateY(-50%);
  pointer-events: none;
}
.rd-search :deep(.p-inputtext) {
  padding-inline-start: 2.375rem;
  background: var(--app-canvas);
}
.rd-kind {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}
.rd-kind-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2.25rem;
  padding: 0.25rem 0.875rem;
  border: 1px solid var(--app-border);
  border-radius: 999px;
  background: var(--app-card);
  color: var(--app-body);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}
.rd-kind-chip .pi {
  font-size: 0.75rem;
}
.rd-kind-chip:hover {
  border-color: color-mix(in srgb, var(--p-primary-color) 40%, transparent);
  color: var(--app-heading);
}
.rd-kind-chip.is-on {
  border-color: transparent;
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
}
.rd-kind-chip:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}
.rd-notes {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rd-notes > li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1.5rem;
}
.rd-notes > li + li {
  border-top: 1px solid var(--app-border);
}
.rd-notes > li:hover {
  background: color-mix(in srgb, var(--app-menu-hover) 70%, transparent);
}
.rd-kind-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
}
.rd-note-main {
  display: grid;
  flex: 1;
  min-width: 0;
}
.rd-note-main a {
  color: var(--app-heading);
  font-weight: 600;
  overflow-wrap: anywhere;
  text-decoration: none;
}
/* The whole row opens the note. */
.rd-note-main a::after {
  content: '';
  position: absolute;
  inset: 0;
}
.rd-note-main a:focus-visible {
  outline: none;
}
.rd-notes > li:has(a:focus-visible) {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
}
.rd-notes > li:hover .rd-note-main a {
  color: var(--p-primary-color);
}
.rd-note-sub {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-note-go {
  color: var(--app-muted);
  font-size: 0.875rem;
}
.rd-side-icon {
  display: inline-grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
}
.rd-form {
  display: grid;
  justify-items: start;
  gap: 0.5rem;
  margin-block-start: 1rem;
}
.rd-form > label {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.rd-form small {
  color: var(--app-muted);
  font-size: 0.8125rem;
  line-height: 1.5;
}
.rd-error {
  color: var(--c-danger);
  font-size: 0.8125rem;
}
@media (max-width: 575.98px) {
  .rd-filters,
  .rd-notes > li {
    padding-inline: 1rem;
  }
}
</style>
