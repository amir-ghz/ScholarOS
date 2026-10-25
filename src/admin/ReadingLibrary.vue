<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import Skeleton from 'primevue/skeleton';
import AdminShell from './AdminShell.vue';
import ReadingDraftButton from './ReadingDraftButton.vue';
import ReadingNav from './ui/reading/ReadingNav.vue';
import { sourceTint } from './ui/reading/sources';
import { api, report, toast } from './api';
import { visible } from './career';
import { formatDate } from './dates';
import { SOURCE_NAMES, authorsLine } from './reading';
import type { AdminCtx } from './types';
import { DRAFT_MAX_PAPERS } from '../lib/reading/limits';
import type { LibraryItem } from '../lib/reading/types';

// Titles and authors are third-party text: shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const room = (id: number) => `${base}/reading/papers/${id}`;

const papers = ref<LibraryItem[] | null>(null);
const paperRef = ref('');
const adding = ref(false);
const addError = ref('');

// Papers ticked for a draft, in the order ticked: 1 to DRAFT_MAX_PAPERS make a post.
const selected = ref<number[]>([]);
const draftFrom = computed(() =>
  selected.value.length && selected.value.length <= DRAFT_MAX_PAPERS ? { papers: [...selected.value] } : null,
);
const draftHint = computed(() =>
  selected.value.length > DRAFT_MAX_PAPERS
    ? `A post can draw on up to ${DRAFT_MAX_PAPERS} papers.`
    : 'Writes an unpublished draft in your voice from the selected papers (a roundup when there are several) and your notes, and opens it in the blog editor. One reading-room AI call.',
);

/** Saves the paper by arXiv id or DOI and opens its room. */
async function add() {
  adding.value = true;
  try {
    const { id } = await api<{ id: number }>('reading/papers', { body: { ref: paperRef.value.trim() } });
    location.href = room(id);
  } catch (e) {
    addError.value = (e as Error).message;
    adding.value = false;
  }
}

function focusSave(id: number | null) {
  void nextTick(() => {
    const row = id === null ? null : document.querySelector(`[data-row="${id}"]`);
    (row?.querySelector<HTMLElement>('button') ?? document.getElementById('adm-main'))?.focus();
  });
}

/** Unsaving removes the row, and focus moves to the next row's button; Undo saves it again in its place. */
async function unsave(item: LibraryItem) {
  const list = papers.value!;
  try {
    await api(`reading/papers/${item.paper.id}`, { method: 'PATCH', body: { state: 'new' } });
  } catch (e) {
    return report(e);
  }
  const at = list.indexOf(item); // after the await: a double click's first unsave may have removed it already
  if (at < 0) return;
  list.splice(at, 1);
  selected.value = selected.value.filter((id) => id !== item.paper.id);
  focusSave((list[at] ?? list[at - 1])?.paper.id ?? null);
  toast('Removed from the library', undefined, {
    label: 'Undo',
    run: async () => {
      try {
        await api(`reading/papers/${item.paper.id}`, { method: 'PATCH', body: { state: 'saved' } });
      } catch (e) {
        return report(e);
      }
      list.splice(Math.min(at, list.length), 0, item);
      focusSave(item.paper.id);
    },
  });
}

onMounted(async () => {
  try {
    papers.value = (await api<{ papers: LibraryItem[] }>('reading/papers')).papers;
  } catch (e) {
    report(e);
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/library" title="Library">
    <ReadingNav :base="base" current="library" />

    <section class="card rd-add" aria-labelledby="rd-add-head">
      <span class="stat-icon tint-primary" aria-hidden="true"><i class="pi pi-plus" /></span>
      <div class="rd-add-body">
        <h2 id="rd-add-head" class="card-title">Add a paper</h2>
        <form class="rd-add-form" @submit.prevent="add">
          <label for="adm-library-ref" class="rd-label">arXiv id or DOI</label>
          <div class="rd-add-row">
            <InputText
              id="adm-library-ref"
              v-model="paperRef"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :invalid="!!addError"
              :aria-invalid="!!addError || undefined"
              :aria-describedby="addError ? 'adm-library-error' : undefined"
              @input="addError = ''"
            />
            <Button
              type="submit"
              icon="pi pi-plus"
              :label="adding ? 'Adding…' : 'Add'"
              :disabled="adding || !paperRef.trim()"
            />
          </div>
          <span v-if="addError" id="adm-library-error" class="rd-error" role="alert">{{ addError }}</span>
        </form>
      </div>
    </section>

    <section class="card card-flush" aria-labelledby="rd-saved-head">
      <div class="card-head">
        <h2 id="rd-saved-head" class="card-title">
          <i class="pi pi-bookmark text-primary" aria-hidden="true" /> Saved papers
        </h2>
        <span v-if="papers?.length" class="chip chip-primary">{{ papers.length }}</span>
      </div>
      <div v-if="!papers" class="p-6">
        <p class="adm-visually-hidden">Loading…</p>
        <Skeleton v-for="n in 4" :key="n" height="3.25rem" class="mb-3" />
      </div>
      <div v-else-if="!papers.length" class="empty-state">
        <i class="pi pi-bookmark" aria-hidden="true" />
        <p>No saved papers yet. Save one from Today, or add one by its arXiv id or DOI.</p>
      </div>
      <template v-else>
        <div class="rd-bulk" :class="{ 'is-active': selected.length }">
          <span class="rd-bulk-count" role="status">
            <i class="pi pi-check-square" aria-hidden="true" /> {{ selected.length }} selected
          </span>
          <ReadingDraftButton :ctx="ctx" :from="draftFrom" :hint="draftHint" />
        </div>
        <div class="rd-lib-grid rd-lib-head" aria-hidden="true">
          <span />
          <span>Paper</span>
          <span>Source</span>
          <span>Saved</span>
          <span />
        </div>
        <ul class="rd-lib-rows">
          <li v-for="item in papers" :key="item.paper.id" :data-row="item.paper.id" class="rd-lib-grid">
            <Checkbox
              v-model="selected"
              :value="item.paper.id"
              :aria-label="`Select “${visible(item.paper.title)}”`"
              class="rd-lib-pick"
            />
            <div class="rd-lib-paper">
              <span :class="['rd-thumb', `tint-${sourceTint(item.paper.source)}`]" aria-hidden="true"
                ><i class="pi pi-file"
              /></span>
              <div class="min-w-0">
                <a class="rd-lib-title" :href="room(item.paper.id)" dir="auto">{{ visible(item.paper.title) }}</a>
                <span v-if="item.paper.authors.length" class="rd-lib-sub" dir="auto">{{
                  authorsLine(item.paper.authors)
                }}</span>
              </div>
            </div>
            <span class="rd-lib-source"
              ><span :class="['chip', `chip-${sourceTint(item.paper.source)}`]">{{
                SOURCE_NAMES[item.paper.source] ?? item.paper.source
              }}</span></span
            >
            <span class="rd-lib-date">saved {{ formatDate(item.savedAt) }}</span>
            <span class="rd-lib-action">
              <Button size="small" icon="pi pi-bookmark-fill" label="Saved" aria-pressed="true" @click="unsave(item)" />
            </span>
          </li>
        </ul>
      </template>
    </section>
  </AdminShell>
</template>

<style scoped>
.rd-add {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-block-end: 1rem;
}
.rd-add .stat-icon {
  flex: none;
  margin: 0;
}
.rd-add-body {
  flex: 1;
  min-width: 0;
}
.rd-add-form {
  display: grid;
  gap: 0.375rem;
  margin-block-start: 0.75rem;
  max-width: 40rem;
}
.rd-label {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.rd-add-row {
  display: flex;
  gap: 0.5rem;
}
.rd-add-row :deep(.p-inputtext) {
  flex: 1;
  min-width: 0;
}
.rd-error {
  color: var(--c-danger);
  font-size: 0.8125rem;
}

/* The bulk bar: what is ticked and what to do with it (Conca's list toolbar). */
.rd-bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.75rem 1.25rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--app-border);
  transition: background 0.15s;
}
.rd-bulk.is-active {
  background: color-mix(in srgb, var(--p-primary-color) 6%, transparent);
}
.rd-bulk-count {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.rd-bulk:not(.is-active) .rd-bulk-count {
  color: var(--app-muted);
  font-weight: 500;
}
.rd-bulk :deep(.rd-draft) {
  flex: 1 1 22rem;
}

.rd-lib-grid {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr) 9rem 8.5rem 7rem;
  align-items: center;
  gap: 1rem;
  padding: 0.875rem 1.5rem;
}
.rd-lib-head {
  padding-block: 0.75rem;
  background: var(--app-canvas);
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.rd-lib-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rd-lib-rows > li + li {
  border-top: 1px solid var(--app-border);
}
.rd-lib-rows > li:hover {
  background: color-mix(in srgb, var(--app-menu-hover) 70%, transparent);
}
.rd-lib-pick {
  justify-self: center;
}
.rd-lib-paper {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
}
.rd-thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 0.5rem;
  font-size: 1.125rem;
}
.rd-lib-title {
  display: block;
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
  text-decoration: none;
}
.rd-lib-title:hover {
  color: var(--p-primary-color);
}
.rd-lib-sub {
  display: block;
  margin-block-start: 0.125rem;
  overflow: hidden;
  color: var(--app-muted);
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rd-lib-date {
  color: var(--app-body);
  font-size: 0.875rem;
}
.rd-lib-action {
  justify-self: end;
}
@media (max-width: 991.98px) {
  .rd-lib-head {
    display: none;
  }
  .rd-lib-grid {
    grid-template-columns: 2rem minmax(0, 1fr) auto;
    gap: 0.5rem 0.75rem;
    padding-inline: 1rem;
  }
  .rd-lib-paper {
    grid-column: 2 / 4;
  }
  .rd-lib-source,
  .rd-lib-date {
    grid-row: 2;
  }
  .rd-lib-source {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .rd-lib-date {
    grid-column: 2;
    grid-row: 3;
    font-size: 0.8125rem;
    color: var(--app-muted);
  }
  .rd-lib-action {
    grid-column: 3;
    grid-row: 2 / 4;
    align-self: center;
  }
  .rd-thumb {
    width: 2.5rem;
    height: 2.5rem;
  }
  .rd-bulk {
    padding-inline: 1rem;
  }
}
@media (max-width: 575.98px) {
  .rd-add {
    flex-direction: column;
  }
  .rd-add .stat-icon {
    display: none;
  }
}
</style>
