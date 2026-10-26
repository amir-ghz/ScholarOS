<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- front matter is user data */
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import AdminShell from './AdminShell.vue';
import AiAssist from './AiAssist.vue';
import DocBanners from './DocBanners.vue';
import FormFields from './FormFields.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import PaperReview from './PaperReview.vue';
import { api, committed, report, toast } from './api';
import { formatDate } from './dates';
import { COLLECTIONS, resolveOptions, type Option } from './fields';
import { useDocument } from './useDocument';
import { HIDE_ICON } from './ui/content/pt';
import type { AdminCtx, CommitResult, Entry } from './types';
import { normalizeAreas, type ResearchAreaInput } from '../lib/editorial';
import { suggestSlug } from '../lib/utils';

type Doc = { data: Record<string, any>; body: string };

const props = defineProps<{ ctx: AdminCtx; name: string }>();
const cfg = COLLECTIONS[props.name];
const entries = ref<Entry[]>([]);
const selected = ref<string | null>(null);
const creating = ref(false);
const newSlug = ref('');
const confirmDelete = ref(false);
const filters = ref<Record<string, string>>({});
const topics = ref<Option[]>([]);
const doc = useDocument<Doc>();
const reviewing = ref(false);

const path = (slug: string) => `src/content/${props.name}/${slug}.md`;
const fields = computed(() => resolveOptions(cfg.fields, { topics: topics.value }));
/** A new entry's form: the title, then the slug derived from it, then everything else. */
const titleFields = computed(() => fields.value.filter((f) => f.key === cfg.titleKey));
const otherFields = computed(() => fields.value.filter((f) => f.key !== cfg.titleKey));
const title = (e: Entry) => String(e.data[cfg.titleKey] || e.slug);
const when = (e: Entry) => (cfg.dateKey ? String(e.data[cfg.dateKey] ?? '').slice(0, 10) : '');
const filterOptions = (key: string) =>
  [...new Set(entries.value.map((e) => String(e.data[key] ?? '')).filter(Boolean))].sort().reverse();
const visible = computed(() =>
  entries.value
    .filter((e) => Object.entries(filters.value).every(([k, v]) => !v || String(e.data[k] ?? '') === v))
    .sort((a, b) => when(b).localeCompare(when(a)) || title(a).localeCompare(title(b))),
);
const typedTitle = computed(() => String(doc.current?.data[cfg.titleKey] ?? '').trim());
const suggested = computed(() => suggestSlug(typedTitle.value));
/** A title with no ASCII letters or digits (e.g. Persian) gives no slug, so the field asks for one. */
const slugNeeded = computed(() => !newSlug.value && !suggested.value && !!typedTitle.value);

onMounted(async () => {
  try {
    entries.value = await api<Entry[]>(`collections/${props.name}`);
  } catch (e) {
    report(e);
  }
  if (props.name === 'publications') {
    api<{ data: { areas?: ResearchAreaInput[] } }>('config/research').then(({ data }) => {
      topics.value = [
        ...normalizeAreas(data.areas).map((a) => ({ value: a.id, label: a.title })),
        { value: 'other', label: 'Other' },
      ];
    }, report);
  }
  const query = new URLSearchParams(location.search);
  const wanted = query.get('slug');
  if (wanted) await select(wanted);
  else if (query.has('new')) startNew();
});

async function select(slug: string) {
  creating.value = false;
  confirmDelete.value = false;
  selected.value = slug;
  history.replaceState(null, '', `?slug=${encodeURIComponent(slug)}`);
  await doc.open(`${props.name}/${slug}`, loadEntry(slug));
}

const loadEntry = (slug: string) => async () => {
  const entry = await api<Doc & { version: string; readonly: boolean }>(`collections/${props.name}/${slug}`);
  return { value: { data: entry.data, body: entry.body }, version: entry.version, readonly: entry.readonly };
};

function startNew() {
  creating.value = true;
  selected.value = null;
  newSlug.value = '';
  history.replaceState(null, '', location.pathname);
  doc.open(`${props.name}/new`, async () => ({ value: { data: structuredClone(cfg.blank), body: '' }, version: null }));
}

async function save() {
  if (!doc.current) return;
  const slug = creating.value ? newSlug.value || suggested.value : selected.value!;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    toast('The slug needs 1–80 lowercase letters, digits or dashes');
    return;
  }
  const result = await doc.save(
    (v, version) =>
      api<CommitResult>(`collections/${props.name}/${slug}`, {
        method: 'PUT',
        body: { data: v.data, body: v.body, version },
      }),
    path(slug),
  );
  if (!result) return;
  const entry: Entry = { slug, data: { ...doc.current.data }, version: result.versions[path(slug)] ?? '' };
  entries.value = [...entries.value.filter((e) => e.slug !== slug), entry];
  if (creating.value) {
    creating.value = false;
    selected.value = slug;
    doc.retarget(`${props.name}/${slug}`, loadEntry(slug));
    history.replaceState(null, '', `?slug=${encodeURIComponent(slug)}`);
  }
}

async function remove() {
  if (!selected.value || !doc.version) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  confirmDelete.value = false;
  try {
    committed(
      await api<CommitResult>(`collections/${props.name}/${selected.value}`, {
        method: 'DELETE',
        body: { version: doc.version },
      }),
    );
    entries.value = entries.value.filter((e) => e.slug !== selected.value);
    selected.value = null;
    doc.current = null;
    history.replaceState(null, '', location.pathname);
  } catch (e) {
    report(e);
  }
}
</script>

<template>
  <AdminShell
    :ctx="ctx"
    :active="name === 'publications' ? 'publications' : `content/${name}`"
    :title="cfg.label"
    :dirty="doc.dirty"
  >
    <template #actions>
      <Button
        v-if="name === 'publications'"
        icon="pi pi-list-check"
        label="Complete papers"
        severity="secondary"
        outlined
        :pt="HIDE_ICON"
        @click="reviewing = true"
      />
      <Button icon="pi pi-plus" :label="`New ${cfg.singular}`" :pt="HIDE_ICON" @click="startNew" />
    </template>
    <PaperReview v-if="reviewing" @close="reviewing = false" />
    <div class="co">
      <section aria-label="Entries" class="card card-flush co-list">
        <div class="card-head co-list-head">
          <h2 class="card-title">
            All {{ cfg.label.toLowerCase() }}
            <span class="chip chip-primary">{{ visible.length }}</span>
          </h2>
        </div>
        <div v-if="cfg.filters" class="co-filters">
          <div v-for="key in cfg.filters" :key="key" class="co-filter">
            <span :id="`co-filter-${key}`" class="co-filter-label">{{ key[0].toUpperCase() + key.slice(1) }}</span>
            <Select
              v-model="filters[key]"
              :options="[{ value: '', label: 'All' }, ...filterOptions(key).map((o) => ({ value: o, label: o }))]"
              option-label="label"
              option-value="value"
              placeholder="All"
              :aria-labelledby="`co-filter-${key}`"
              size="small"
              fluid
            />
          </div>
        </div>
        <ul class="co-pick">
          <li v-for="e in visible" :key="e.slug">
            <button type="button" :aria-current="selected === e.slug" @click="select(e.slug)">
              <span class="co-pick-title" dir="auto">{{ title(e) }}</span
              ><time v-if="when(e)" class="co-pick-date" :datetime="when(e)">{{ formatDate(when(e)) }}</time>
            </button>
          </li>
        </ul>
        <div v-if="!visible.length" class="empty-state">
          <i class="pi pi-inbox" aria-hidden="true" />
          <span>Nothing here yet.</span>
        </div>
      </section>
      <section v-if="doc.current" aria-label="Editor" class="card card-flush co-editor">
        <div class="card-head">
          <div class="min-w-0">
            <h2 class="card-title co-editor-title" dir="auto">
              {{ creating ? `New ${cfg.singular}` : typedTitle || selected }}
            </h2>
            <p v-if="selected && !creating" class="card-subtitle co-path">{{ path(selected) }}</p>
          </div>
          <span v-if="creating" class="chip chip-info">New</span>
        </div>
        <div class="co-body">
          <DocBanners
            :draft="!!doc.draft"
            :path="selected && !creating ? path(selected) : undefined"
            :version="doc.version"
            :conflict="doc.conflict"
            :stale="doc.draftStale ? doc.draftChanges : null"
            @restore="doc.restore()"
            @discard="doc.discard()"
            @reload="doc.reload()"
          />
          <p v-if="doc.readonly" class="co-note">
            <i class="pi pi-lock" aria-hidden="true" />
            This entry is MDX: read-only here, edit it in the repository.
          </p>
          <fieldset class="co-fieldset" :disabled="doc.readonly">
            <template v-if="creating">
              <FormFields :fields="titleFields" :model="doc.current.data" :errors="doc.errors" :owner="ctx.siteName" />
              <label class="co-field">
                <span>Slug (file name)</span>
                <!-- Follows the title until edited by hand; clearing it follows the title again. -->
                <InputText
                  :model-value="newSlug || suggested"
                  :aria-describedby="slugNeeded ? 'adm-slug-hint' : undefined"
                  fluid
                  @input="newSlug = ($event.target as HTMLInputElement).value"
                />
                <small v-if="slugNeeded" id="adm-slug-hint"
                  >Type a slug: lowercase letters, digits or dashes. The title has none to suggest one from.</small
                >
              </label>
              <FormFields :fields="otherFields" :model="doc.current.data" :errors="doc.errors" :owner="ctx.siteName" />
            </template>
            <FormFields v-else :fields="fields" :model="doc.current.data" :errors="doc.errors" :owner="ctx.siteName" />
            <div class="co-field" role="group" aria-labelledby="adm-body-label">
              <span id="adm-body-label">Body</span>
              <MarkdownEditor v-model="doc.current.body" compact :preview="doc.readonly" />
            </div>
            <AiAssist
              v-if="(name === 'announcements' || name === 'publications') && !doc.readonly"
              class="co-ai"
              :collection="name"
              :doc="doc.current"
              image-key="image"
              @body="doc.current.body = $event"
            />
          </fieldset>
        </div>
        <div class="co-footer">
          <Button
            :icon="creating ? 'pi pi-plus' : 'pi pi-send'"
            :label="creating ? 'Create' : 'Publish'"
            :disabled="doc.saving || doc.readonly"
            :pt="HIDE_ICON"
            @click="save"
          />
          <Button
            v-if="!creating"
            icon="pi pi-trash"
            :label="confirmDelete ? 'Click again to delete' : 'Delete'"
            severity="danger"
            :outlined="!confirmDelete"
            :disabled="doc.readonly"
            :pt="HIDE_ICON"
            @click="remove"
          />
        </div>
      </section>
      <section v-else class="card co-empty">
        <div class="empty-state">
          <span class="stat-icon tint-primary" aria-hidden="true"><i class="pi pi-file-edit" /></span>
          <p class="co-empty-text">Choose an entry or create a new one.</p>
        </div>
      </section>
    </div>
  </AdminShell>
</template>

<style scoped>
.co {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  align-items: start;
  gap: 1.5rem;
}
@media (max-width: 1199.98px) {
  .co {
    grid-template-columns: minmax(0, 1fr);
  }
}
.co-list {
  display: flex;
  flex-direction: column;
}
@media (min-width: 1200px) {
  .co-list {
    position: sticky;
    inset-block-start: calc(var(--app-header-height) + 1.5rem);
    max-height: calc(100vh - var(--app-header-height) - 3rem);
  }
}
.co-list-head .chip {
  font-size: 0.75rem;
}
.co-filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--app-border);
}
.co-filter {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.co-filter-label {
  color: var(--app-muted);
  font-size: 0.75rem;
  font-weight: 500;
}
.co-pick {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0.5rem;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: thin;
}
@media (max-width: 1199.98px) {
  .co-pick {
    max-height: 22rem;
  }
}
.co-pick li + li {
  border-top: 1px dashed var(--app-border);
}
.co-pick button {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  width: 100%;
  padding: 0.75rem 1rem;
  border: 0;
  border-radius: 0.5rem;
  background: none;
  color: var(--app-heading);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: background 0.15s;
}
.co-pick button:hover {
  background: var(--app-menu-hover);
}
.co-pick button[aria-current='true'] {
  background: color-mix(in srgb, var(--p-primary-color) 10%, transparent);
  box-shadow: inset 3px 0 0 var(--p-primary-color);
}
.co-pick button[aria-current='true'] .co-pick-title {
  color: var(--p-primary-color);
}
.co-pick-title {
  display: -webkit-box;
  overflow: hidden;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.co-pick-date {
  color: var(--app-muted);
  font-size: 0.75rem;
  font-weight: 500;
}
/* Visible overflow: the action bar sticks to the bottom of the viewport while the form scrolls. */
.co-editor {
  overflow: visible;
}
.co-editor-title {
  overflow-wrap: anywhere;
}
.co-path {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}
.co-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
}
.co-fieldset {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.co-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.co-field > span {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.co-field small {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.co-field :deep(input.p-inputtext) {
  padding: var(--p-inputtext-padding-y) var(--p-inputtext-padding-x);
  border-color: var(--p-inputtext-border-color);
  font-size: 0.9375rem;
}
.co-field :deep(input.p-inputtext:enabled:focus) {
  border-color: var(--p-inputtext-focus-border-color);
}
/* AI assist sits in the editor card as a tinted panel rather than a card in a card. */
.co-fieldset > .co-ai {
  margin-block-start: 0.25rem;
  padding: 1.25rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--app-canvas) 45%, var(--app-card));
  box-shadow: none;
}
.co-note {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin: 0;
  padding: 0.875rem 1rem;
  border: 1px solid color-mix(in srgb, var(--c-info) 30%, var(--app-border));
  border-inline-start: 4px solid var(--c-info);
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--c-info) 8%, var(--app-card));
  color: var(--app-heading);
  font-size: 0.875rem;
}
.co-footer {
  position: sticky;
  inset-block-end: 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--app-border);
  border-end-start-radius: inherit;
  border-end-end-radius: inherit;
  background: color-mix(in srgb, var(--app-card) 94%, transparent);
  backdrop-filter: blur(6px);
}
.co-empty {
  display: grid;
  place-items: center;
  min-height: 18rem;
}
.co-empty-text {
  margin: 0;
}
@media (max-width: 575.98px) {
  .co-body {
    padding: 1.25rem 1rem;
  }
  .co-footer {
    padding-inline: 1rem;
  }
  .co-filters {
    padding-inline: 1rem;
  }
}
</style>
