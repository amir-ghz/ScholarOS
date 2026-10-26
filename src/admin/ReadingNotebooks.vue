<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Skeleton from 'primevue/skeleton';
import AdminShell from './AdminShell.vue';
import ReadingNav from './ui/reading/ReadingNav.vue';
import { api, report, toast } from './api';
import { visible } from './career';
import { relativeTime } from './dates';
import { vDialog } from './dialog';
import type { AdminCtx } from './types';

interface Notebook {
  id: number;
  title: string;
  papers: number;
  updatedAt: string;
}

// Titles are the owner's, but may come from a paper's title: shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const open = (id: number) => `${base}/reading/notebooks/${id}`;

const notebooks = ref<Notebook[] | null>(null);
const title = ref('');
const creating = ref(false);
const createError = ref('');
const confirming = ref<Notebook | null>(null);
const deleting = ref(false);

const TINTS = ['primary', 'success', 'warning', 'info', 'pink'];
const line = (n: Notebook) => `${n.papers} paper${n.papers === 1 ? '' : 's'} · updated ${relativeTime(n.updatedAt)}`;

async function create() {
  creating.value = true;
  try {
    const { id } = await api<{ id: number }>('reading/notebooks', { body: { title: title.value.trim() } });
    location.href = open(id);
  } catch (e) {
    createError.value = (e as Error).message;
    creating.value = false;
  }
}

async function remove() {
  const n = confirming.value!;
  deleting.value = true;
  try {
    await api(`reading/notebooks/${n.id}`, { method: 'DELETE' });
    notebooks.value = notebooks.value!.filter((x) => x.id !== n.id);
    confirming.value = null;
    // The row's Delete, where the dialog would return focus, is gone.
    void nextTick(() => document.getElementById('adm-main')?.focus());
    toast('Notebook deleted');
  } catch (e) {
    report(e);
  } finally {
    deleting.value = false;
  }
}

onMounted(async () => {
  try {
    notebooks.value = (await api<{ notebooks: Notebook[] }>('reading/notebooks')).notebooks;
  } catch (e) {
    report(e);
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/notebooks" title="Notebooks">
    <ReadingNav :base="base" current="notebooks" />

    <section class="card rd-new" aria-labelledby="rd-new-head">
      <span class="stat-icon tint-primary" aria-hidden="true"><i class="pi pi-file-edit" /></span>
      <div class="rd-new-body">
        <h2 id="rd-new-head" class="card-title">New notebook</h2>
        <form class="rd-new-form" @submit.prevent="create">
          <label for="adm-notebook-title" class="rd-label">Title</label>
          <div class="rd-new-row">
            <InputText
              id="adm-notebook-title"
              v-model="title"
              type="text"
              maxlength="200"
              :invalid="!!createError"
              :aria-invalid="!!createError || undefined"
              :aria-describedby="createError ? 'adm-notebook-error' : undefined"
              @input="createError = ''"
            />
            <Button
              type="submit"
              icon="pi pi-plus"
              :label="creating ? 'Creating…' : 'Create'"
              :disabled="creating || !title.trim()"
            />
          </div>
          <span v-if="createError" id="adm-notebook-error" class="rd-error" role="alert">{{ createError }}</span>
        </form>
      </div>
    </section>

    <section aria-labelledby="rd-yours-head">
      <div class="rd-yours-head">
        <h2 id="rd-yours-head" class="card-title">Your notebooks</h2>
        <span v-if="notebooks?.length" class="chip chip-primary">{{ notebooks.length }}</span>
      </div>
      <div v-if="!notebooks" class="rd-grid">
        <p class="adm-visually-hidden">Loading…</p>
        <div v-for="n in 3" :key="n" class="card"><Skeleton height="7.5rem" /></div>
      </div>
      <div v-else-if="!notebooks.length" class="card empty-state">
        <i class="pi pi-book" aria-hidden="true" />
        <p>No notebooks yet. A notebook groups papers so the summary, study aids and chat work across them.</p>
      </div>
      <ul v-else class="rd-grid">
        <li v-for="(n, k) in notebooks" :key="n.id" class="card rd-nb">
          <div class="rd-nb-top">
            <span :class="['rd-nb-icon', `tint-${TINTS[k % TINTS.length]}`]" aria-hidden="true"
              ><i class="pi pi-book"
            /></span>
            <span class="chip chip-secondary"><i class="pi pi-file" aria-hidden="true" /> {{ n.papers }}</span>
          </div>
          <a class="rd-nb-title" :href="open(n.id)" dir="auto">{{ visible(n.title) }}</a>
          <p class="rd-nb-line">{{ line(n) }}</p>
          <div class="rd-nb-foot">
            <Button
              as="a"
              :href="open(n.id)"
              label="Open"
              icon="pi pi-arrow-right"
              icon-pos="right"
              size="small"
              text
              tabindex="-1"
              aria-hidden="true"
            />
            <Button
              icon="pi pi-trash"
              label="Delete"
              severity="danger"
              text
              size="small"
              :aria-label="`Delete ${visible(n.title)}`"
              @click="confirming = n"
            />
          </div>
        </li>
      </ul>
    </section>

    <div
      v-if="confirming"
      v-dialog
      class="rd-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adm-notebook-delete"
      @keydown.esc="confirming = null"
    >
      <div class="rd-modal-box">
        <span class="stat-icon tint-danger" aria-hidden="true"><i class="pi pi-trash" /></span>
        <h2 id="adm-notebook-delete" class="rd-modal-title">Delete “{{ visible(confirming.title) }}”?</h2>
        <p>
          Its summary, study aids and chat are deleted with it. Its note and saved answers stay in the vault, and the
          papers themselves are kept.
        </p>
        <div class="rd-modal-actions">
          <Button label="Cancel" severity="secondary" outlined data-autofocus @click="confirming = null" />
          <Button label="Delete notebook" severity="danger" :disabled="deleting" @click="remove" />
        </div>
      </div>
    </div>
  </AdminShell>
</template>

<style scoped>
.rd-new {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-block-end: 1.5rem;
}
.rd-new .stat-icon {
  flex: none;
  margin: 0;
}
.rd-new-body {
  flex: 1;
  min-width: 0;
}
.rd-new-form {
  display: grid;
  gap: 0.375rem;
  max-width: 40rem;
  margin-block-start: 0.75rem;
}
.rd-label {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.rd-new-row {
  display: flex;
  gap: 0.5rem;
}
.rd-new-row :deep(.p-inputtext) {
  flex: 1;
  min-width: 0;
}
.rd-error {
  color: var(--c-danger);
  font-size: 0.8125rem;
}
.rd-yours-head {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-block-end: 1rem;
}

/* A card per notebook (Conca's course grid). */
.rd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rd-nb {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
}
.rd-nb:hover {
  transform: translateY(-2px);
  box-shadow: var(--app-shadow-float);
}
.rd-nb-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-block-end: 0.5rem;
}
.rd-nb-icon {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 0.625rem;
  font-size: 1.25rem;
}
.rd-nb-title {
  color: var(--app-heading);
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
  text-decoration: none;
}
.rd-nb-title:hover {
  color: var(--p-primary-color);
}
.rd-nb-line {
  margin: 0;
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-nb-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-block-start: auto;
  margin-inline: -0.75rem -0.75rem;
  padding-block-start: 0.75rem;
  border-top: 1px dashed var(--app-border);
}
.rd-nb-foot > :first-child {
  margin-inline-start: 0.25rem;
}

/* The delete confirm (v-dialog keeps focus in it). */
.rd-modal {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(25 24 34 / 0.45);
  backdrop-filter: blur(2px);
}
.rd-modal-box {
  width: min(460px, 100%);
  padding: 1.75rem;
  border-radius: var(--app-radius-card);
  background: var(--app-card);
  box-shadow: var(--app-shadow-float);
  text-align: center;
}
.rd-modal-box .stat-icon {
  margin: 0 auto 1rem;
}
.rd-modal-title {
  margin: 0 0 0.5rem;
  color: var(--app-heading);
  font-size: 1.125rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.rd-modal-box p {
  margin: 0;
  color: var(--app-body);
  font-size: 0.875rem;
}
.rd-modal-actions {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  margin-block-start: 1.5rem;
}
@media (max-width: 575.98px) {
  .rd-new {
    flex-direction: column;
  }
  .rd-new .stat-icon {
    display: none;
  }
}
</style>
