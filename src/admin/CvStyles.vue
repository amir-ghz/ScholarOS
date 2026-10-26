<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import { parse, stringify } from 'yaml';
import Button from 'primevue/button';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import DesignForm from './DesignForm.vue';
import DocBanners from './DocBanners.vue';
import { api, committed, report, toast } from './api';
import { useDocument } from './useDocument';
import schema from '../../services/cv-render/design-schema.json';
import { designFields } from '../lib/cv-design-fields';
import type { CvStyle, CvStylesConfig, Density } from '../lib/types';
import type { AdminCtx, CommitResult } from './types';

defineProps<{ ctx: AdminCtx }>();
const doc = useDocument<CvStylesConfig>();
const builtIn = ref<string[]>([]);
const themes = ref<string[]>([]);
const selectedId = ref('');
const confirmDelete = ref(false);
const confirmTheme = ref('');
const DENSITIES: [Density, string][] = [
  ['compact', 'Compact'],
  ['normal', 'Normal'],
  ['airy', 'Airy'],
];

const styles = computed(() => doc.current?.styles ?? []);
const style = computed(() => styles.value.find((s) => s.id === selectedId.value));
const groups = computed(() => (style.value ? designFields(schema, style.value.theme, style.value.density) : []));
const LABELS: Record<string, string> = {
  engineeringresumes: 'Engineering resumes',
  engineeringclassic: 'Engineering classic',
  moderncv: 'ModernCV',
};
const label = (theme: string) => LABELS[theme] ?? theme[0].toUpperCase() + theme.slice(1);
const densityLabel = (d: Density) => DENSITIES.find(([k]) => k === d)?.[1] ?? d;
const THEME_OPTIONS = computed(() => [
  ...builtIn.value.map((t) => ({ value: t, label: label(t) })),
  ...themes.value.map((t) => ({ value: t, label: `${t} (uploaded)` })),
  ...(style.value && ![...builtIn.value, ...themes.value].includes(style.value.theme)
    ? [{ value: style.value.theme, label: `${style.value.theme} (missing)` }]
    : []),
]);

onMounted(() => {
  void doc.open('config/cv-styles', async () => {
    const res = await api<{
      data: CvStylesConfig;
      version: string | null;
      builtIn: string[];
      themes: string[];
    }>('cv/styles');
    builtIn.value = res.builtIn;
    themes.value = res.themes;
    return { value: res.data, version: res.version };
  });
});

// ── The style list ──
function select(id: string) {
  selectedId.value = id;
  confirmDelete.value = false;
}
/** A style id (STYLE_ID in cv-styles.ts) from its name, unique among the styles. */
function newId(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'style';
  let id = base;
  for (let n = 2; styles.value.some((s) => s.id === id); n++) id = `${base}-${n}`;
  return id;
}
function add(from: Omit<CvStyle, 'id' | 'name'>, suggested: string) {
  const name = window.prompt('Style name', suggested)?.trim();
  if (!name || !doc.current) return;
  const id = newId(name);
  doc.current.styles.push({ ...structuredClone(toRaw(from)), id, name });
  select(id);
}
const useTheme = (theme: string) => add({ theme, density: 'normal', design: {} }, label(theme));
const duplicate = () => style.value && add(style.value, `${style.value.name} copy`);
function rename() {
  const name = style.value && window.prompt('Style name', style.value.name)?.trim();
  if (name && style.value) style.value.name = name;
}
function remove() {
  if (!doc.current || !style.value || styles.value.length < 2) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  doc.current.styles = styles.value.filter((s) => s.id !== selectedId.value);
  if (doc.current.public === selectedId.value) doc.current.public = doc.current.styles[0].id;
  select(doc.current.public);
}
function setPublic() {
  if (doc.current && style.value) doc.current.public = style.value.id;
}

async function save() {
  await doc.save(
    (data, version) => api<CommitResult>('config/cv-styles', { method: 'PUT', body: { data, version } }),
    'config/cv-styles.yml',
  );
}
// Opening, a reload or a restored draft can leave no style selected: select the public one.
watch(styles, () => {
  if (doc.current && !style.value) select(doc.current.public);
});

// ── Custom themes (publishers only: their templates run inside the renderer) ──
async function uploadTheme(e: Event) {
  const input = e.target as HTMLInputElement;
  const picked = [...(input.files ?? [])];
  input.value = '';
  if (!picked.length) return;
  const folder = picked[0]?.webkitRelativePath.split('/')[0] ?? '';
  const name = window.prompt(
    'Theme name (lowercase letters and digits)',
    folder.toLowerCase().replace(/[^a-z0-9]/g, ''),
  );
  if (!name) return;
  const typ = picked.filter((f) => f.name.endsWith('.typ'));
  if (!typ.length) return toast('That folder has no .typ template files');
  const files = Object.fromEntries(
    await Promise.all(typ.map(async (f) => [f.webkitRelativePath.split('/').slice(1).join('/'), await f.text()])),
  );
  try {
    committed(await api<CommitResult>(`cv/themes/${encodeURIComponent(name)}`, { method: 'PUT', body: { files } }));
    if (!themes.value.includes(name)) themes.value.push(name);
    preview();
  } catch (err) {
    report(err);
  }
}
async function deleteTheme(name: string) {
  if (confirmTheme.value !== name) {
    confirmTheme.value = name;
    return;
  }
  confirmTheme.value = '';
  try {
    committed(await api<CommitResult>(`cv/themes/${encodeURIComponent(name)}`, { method: 'DELETE' }));
    themes.value = themes.value.filter((t) => t !== name);
  } catch (err) {
    report(err);
  }
}

// ── Advanced: the raw design YAML, kept in step with the form ──
const yamlText = ref('');
const yamlError = ref('');
const sameDesign = (text: string, design: unknown) => {
  try {
    return JSON.stringify(parse(text) ?? {}) === JSON.stringify(design);
  } catch {
    return false;
  }
};
watch(
  () => style.value?.design,
  (design) => {
    if (!design || sameDesign(yamlText.value, design)) return;
    yamlText.value = Object.keys(design).length ? stringify(design) : '';
    yamlError.value = '';
  },
  { deep: true, immediate: true },
);
function editYaml(text: string) {
  yamlText.value = text;
  try {
    const design = parse(text) ?? {};
    if (typeof design !== 'object' || Array.isArray(design)) throw new Error('The design is a map of RenderCV keys');
    yamlError.value = '';
    if (style.value) style.value.design = design;
  } catch (e) {
    yamlError.value = (e as Error).message.split('\n')[0];
  }
}

// ── Live preview: RenderCV renders the unsaved style; a failed render keeps that style's last good PDF ──
/** The last PDF and the style it shows: another style's PDF is never shown (or downloaded) as this one's. */
const pdf = ref<{ url: string; styleId: string } | null>(null);
const pdfUrl = computed(() => (pdf.value?.styleId === selectedId.value ? pdf.value.url : ''));
const renderError = ref('');
const rendering = ref(false);
let timer: number | undefined;
let inFlight: AbortController | null = null;
let previewedId = '';
/** Edits wait 800 ms for the next keystroke; switching styles renders at once. Either way older requests stop now. */
function preview() {
  const switched = selectedId.value !== previewedId;
  previewedId = selectedId.value;
  if (switched) renderError.value = '';
  clearTimeout(timer);
  inFlight?.abort();
  timer = window.setTimeout(render, switched ? 0 : 800);
}
async function render() {
  if (!style.value) return;
  const styleId = style.value.id;
  const ctrl = (inFlight = new AbortController());
  rendering.value = true;
  try {
    // Plain fetch, not api(): a renderer outage is this panel's error, not the admin-wide outage banner.
    const res = await fetch('/api/admin/cv/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style: style.value }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      renderError.value = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? res.statusText;
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    if (pdf.value) URL.revokeObjectURL(pdf.value.url);
    pdf.value = { url, styleId };
    renderError.value = '';
  } catch (e) {
    if ((e as Error).name !== 'AbortError') renderError.value = (e as Error).message;
  } finally {
    if (inFlight === ctrl) {
      inFlight = null;
      rendering.value = false;
    }
  }
}
watch(() => JSON.stringify(style.value ?? null), preview);
onBeforeUnmount(() => {
  clearTimeout(timer);
  inFlight?.abort();
  if (pdf.value) URL.revokeObjectURL(pdf.value.url);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="cv-styles" title="CV" :dirty="doc.dirty">
    <template #actions>
      <Button icon="pi pi-check" label="Publish styles" :disabled="doc.saving || !doc.current" @click="save" />
    </template>
    <AdminTabLinks
      label="CV"
      :tabs="[
        { href: `/${ctx.adminPath}/cv`, label: 'Entries' },
        { href: `/${ctx.adminPath}/cv-styles`, label: 'Styles', current: true },
      ]"
    />
    <DocBanners
      :draft="!!doc.draft"
      :path="'config/cv-styles.yml'"
      :version="doc.version"
      :conflict="doc.conflict"
      :stale="doc.draftStale ? doc.draftChanges : null"
      @restore="doc.restore()"
      @discard="doc.discard()"
      @reload="doc.reload()"
    />

    <div v-if="doc.current" class="sty">
      <section aria-labelledby="adm-my-styles" class="card">
        <div class="card-head">
          <h2 id="adm-my-styles" class="card-title">
            <i class="pi pi-palette text-primary" aria-hidden="true" /> My styles
          </h2>
          <div v-if="style" class="sty-actions">
            <Button icon="pi pi-pencil" label="Rename" size="small" severity="secondary" outlined @click="rename" />
            <Button
              icon="pi pi-clone"
              label="Duplicate"
              size="small"
              severity="secondary"
              outlined
              @click="duplicate"
            />
            <Button
              icon="pi pi-trash"
              :label="confirmDelete ? 'Click again to delete' : 'Delete'"
              size="small"
              severity="danger"
              :outlined="!confirmDelete"
              :disabled="styles.length < 2"
              @click="remove"
            />
          </div>
        </div>
        <ul class="sty-grid">
          <li v-for="s in styles" :key="s.id" class="sty-tile" :class="{ 'is-selected': s.id === selectedId }">
            <span class="sty-paper" aria-hidden="true">
              <span class="sty-paper-name" />
              <span class="sty-paper-rule" />
              <span /><span /><span class="is-short" />
              <span class="sty-paper-rule" />
              <span /><span class="is-short" />
            </span>
            <span class="sty-tile-text">
              <button type="button" class="sty-pick" :aria-current="s.id === selectedId" @click="select(s.id)">
                <span class="sty-name">{{ s.name }}</span>
                <span v-if="s.id === doc.current.public" class="chip chip-success">Public</span>
              </button>
              <span class="sty-meta">{{ label(s.theme) }} · {{ densityLabel(s.density) }}</span>
            </span>
          </li>
        </ul>
      </section>

      <div v-if="style" class="sty-work">
        <section aria-labelledby="sty-settings" class="card sty-settings">
          <div class="card-head">
            <h2 id="sty-settings" class="card-title">
              <i class="pi pi-sliders-h text-primary" aria-hidden="true" /> Style settings
            </h2>
          </div>
          <div class="sty-field">
            <span id="sty-theme">Theme</span>
            <Select
              v-model="style.theme"
              :options="THEME_OPTIONS"
              option-label="label"
              option-value="value"
              aria-labelledby="sty-theme"
              fluid
            />
          </div>
          <div class="sty-field">
            <span aria-hidden="true">Density</span>
            <div class="sty-segments" role="group" aria-label="Density">
              <button
                v-for="[d, name] in DENSITIES"
                :key="d"
                type="button"
                :aria-pressed="style.density === d"
                @click="style.density = d"
              >
                {{ name }}
              </button>
            </div>
          </div>
          <p class="sty-hint">Empty fields inherit the theme and density shown in grey.</p>
          <DesignForm :groups="groups" :design="style.design" />
          <details class="sty-advanced">
            <summary>
              <span>Advanced</span>
              <i class="pi pi-chevron-down sty-chevron" aria-hidden="true" />
            </summary>
            <label class="sty-field sty-yaml">
              <span>Design YAML (RenderCV <code>design</code> keys)</span>
              <Textarea
                :model-value="yamlText"
                rows="12"
                spellcheck="false"
                :aria-invalid="!!yamlError || undefined"
                :invalid="!!yamlError"
                fluid
                @update:model-value="editYaml($event)"
              />
              <span v-if="yamlError" class="sty-err">{{ yamlError }}</span>
            </label>
          </details>
        </section>

        <section aria-labelledby="sty-preview" class="card sty-preview">
          <div class="card-head">
            <h2 id="sty-preview" class="card-title">
              <i class="pi pi-file-pdf text-primary" aria-hidden="true" /> Preview
            </h2>
            <div class="sty-actions">
              <span v-if="rendering" class="sty-rendering" role="status"
                ><i class="pi pi-spin pi-spinner" aria-hidden="true" /> Rendering…</span
              >
              <Button
                :icon="style.id === doc.current.public ? 'pi pi-check-circle' : 'pi pi-globe'"
                label="Set as public download"
                size="small"
                severity="secondary"
                :outlined="style.id !== doc.current.public"
                :aria-pressed="style.id === doc.current.public"
                :class="{ 'is-pressed': style.id === doc.current.public }"
                @click="setPublic"
              />
              <Button
                v-if="pdfUrl"
                as="a"
                icon="pi pi-download"
                label="Download PDF"
                size="small"
                :href="pdfUrl"
                :download="`${style.id}.pdf`"
              />
            </div>
          </div>
          <!-- RenderCV's validation errors are a box-drawn table: keep its columns. -->
          <pre v-if="renderError" class="sty-error" role="alert">{{ renderError }}</pre>
          <iframe v-if="pdfUrl" :src="pdfUrl" title="CV preview" />
          <div v-else-if="!rendering && !renderError" class="empty-state">
            <i class="pi pi-file" aria-hidden="true" />
            <p>The preview appears here.</p>
          </div>
        </section>
      </div>

      <section aria-labelledby="adm-built-in" class="card">
        <div class="card-head">
          <div>
            <h2 id="adm-built-in" class="card-title">
              <i class="pi pi-th-large text-primary" aria-hidden="true" /> Built-in themes
            </h2>
          </div>
        </div>
        <ul class="sty-themes" aria-labelledby="adm-built-in">
          <li v-for="t in builtIn" :key="t">
            <button type="button" :aria-label="`Use ${label(t)} as a new style`" @click="useTheme(t)">
              <span>{{ label(t) }}</span
              ><span class="sty-new"><i class="pi pi-plus" aria-hidden="true" /> New</span>
            </button>
          </li>
        </ul>

        <template v-if="themes.length || ctx.canPublish">
          <h2 id="adm-uploaded" class="card-title sty-subhead">
            <i class="pi pi-upload text-primary" aria-hidden="true" /> Uploaded themes
          </h2>
          <ul v-if="themes.length" class="sty-themes" aria-labelledby="adm-uploaded">
            <li v-for="t in themes" :key="t" class="sty-uploaded">
              <button type="button" :aria-label="`Use ${t} as a new style`" @click="useTheme(t)">
                <span>{{ t }}</span
                ><span class="sty-new"><i class="pi pi-plus" aria-hidden="true" /> New</span>
              </button>
              <Button
                v-if="ctx.canPublish"
                :icon="confirmTheme === t ? undefined : 'pi pi-trash'"
                :label="confirmTheme === t ? 'Confirm' : 'Delete'"
                size="small"
                severity="danger"
                :outlined="confirmTheme !== t"
                :aria-label="confirmTheme === t ? `Click again to delete ${t}` : `Delete theme ${t}`"
                @click="deleteTheme(t)"
              />
            </li>
          </ul>
          <label v-if="ctx.canPublish" class="sty-field sty-upload">
            <span>Upload theme</span>
            <input type="file" webkitdirectory multiple @change="uploadTheme" />
            <small>A folder of RenderCV Typst templates (*.j2.typ). Uploading the same name replaces it.</small>
          </label>
        </template>
      </section>
    </div>
  </AdminShell>
</template>

<style scoped>
.sty {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  margin-block-start: 1.25rem;
}
.sty-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

/* My styles: one card per style, a sketch of a page above its name. */
.sty-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr));
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sty-tile {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  background: var(--app-card);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.sty-tile:hover {
  border-color: color-mix(in srgb, var(--p-primary-color) 40%, var(--app-border));
}
.sty-tile.is-selected {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 6%, var(--app-card));
  box-shadow: 0 0 0 1px var(--p-primary-color);
}
.sty-tile:has(.sty-pick:focus-visible) {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}
.sty-paper {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 0.1875rem;
  width: 2.75rem;
  height: 3.5rem;
  padding: 0.375rem 0.3125rem;
  border: 1px solid var(--app-border);
  border-radius: 0.25rem;
  background: #fff;
  box-shadow: var(--app-shadow-card);
}
.sty-paper > span {
  height: 0.125rem;
  border-radius: 1px;
  background: #d6d5dd;
}
.sty-paper > .is-short {
  width: 60%;
}
.sty-paper > .sty-paper-name {
  width: 70%;
  height: 0.25rem;
  margin-inline: auto;
  background: var(--p-primary-color);
}
.sty-paper > .sty-paper-rule {
  height: 0.0625rem;
  margin-block-start: 0.125rem;
  background: var(--p-primary-color);
}
.sty-tile-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.sty-pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--app-heading);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.sty-pick:focus-visible {
  outline: none;
}
/* The whole card picks the style. */
.sty-pick::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}
.sty-name {
  min-width: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.sty-tile.is-selected .sty-name {
  color: var(--p-primary-color);
}
.sty-meta {
  color: var(--app-muted);
  font-size: 0.75rem;
  font-weight: 500;
}

/* Settings beside the preview; stacked under 1200px. */
.sty-work {
  display: grid;
  grid-template-columns: minmax(20rem, 27rem) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
@media (max-width: 1199.98px) {
  .sty-work {
    grid-template-columns: minmax(0, 1fr);
  }
}
.sty-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.sty-settings > .card-head {
  margin: 0;
}
.sty-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.sty-field > span:first-child {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.sty-field small,
.sty-hint {
  margin: 0;
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.sty-segments {
  display: inline-flex;
  padding: 0.25rem;
  border-radius: 0.5rem;
  background: var(--app-canvas);
}
.sty-segments button {
  flex: 1;
  padding: 0.4375rem 0.75rem;
  border: 0;
  border-radius: 0.375rem;
  background: none;
  color: var(--app-body);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}
.sty-segments button:hover {
  color: var(--app-heading);
}
.sty-segments button[aria-pressed='true'] {
  background: var(--app-card);
  box-shadow: var(--app-shadow-card);
  color: var(--p-primary-color);
}
.sty-advanced {
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
}
.sty-advanced > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-radius: 0.625rem;
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
  list-style: none;
  cursor: pointer;
}
.sty-advanced > summary::-webkit-details-marker {
  display: none;
}
.sty-advanced > summary:hover {
  background: var(--app-menu-hover);
}
.sty-advanced[open] > summary {
  border-bottom: 1px solid var(--app-border);
  border-end-start-radius: 0;
  border-end-end-radius: 0;
}
.sty-advanced[open] .sty-chevron {
  transform: rotate(180deg);
}
.sty-chevron {
  color: var(--app-muted);
  font-size: 0.75rem;
  transition: transform 0.2s;
}
.sty-yaml {
  padding: 1rem;
}
.sty-yaml :deep(textarea) {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}
.sty-err {
  color: var(--c-danger);
  font-size: 0.8125rem;
}

.sty-preview {
  position: sticky;
  inset-block-start: calc(var(--app-header-height) + 1rem);
}
@media (max-width: 1199.98px) {
  .sty-preview {
    position: static;
  }
}
.sty-preview iframe {
  display: block;
  width: 100%;
  height: min(80vh, 1100px);
  border: 1px solid var(--app-border);
  border-radius: 0.5rem;
  background: var(--app-canvas);
}
.sty-preview .empty-state {
  min-height: 20rem;
  border: 1px dashed var(--app-border);
  border-radius: 0.5rem;
}
.sty-preview .empty-state p {
  margin: 0;
}
.sty-rendering {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.sty-preview .is-pressed {
  border-color: color-mix(in srgb, var(--c-success) 40%, transparent);
  background: color-mix(in srgb, var(--c-success) 14%, transparent);
  color: var(--c-success);
}
.sty-error {
  margin: 0 0 1rem;
  padding: 0.875rem 1rem;
  overflow-x: auto;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--c-danger) 8%, var(--app-card));
  box-shadow: inset 4px 0 0 var(--c-danger);
  color: var(--app-heading);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

/* Themes to start a style from. */
.sty-themes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sty-themes button:not(.p-button) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  padding: 0.75rem 0.875rem;
  border: 1px dashed var(--app-border);
  border-radius: 0.625rem;
  background: none;
  color: var(--app-heading);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: start;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.sty-themes button:not(.p-button):hover {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 5%, transparent);
}
.sty-new {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--p-primary-color);
  font-size: 0.75rem;
  font-weight: 600;
}
.sty-new .pi {
  font-size: 0.625rem;
}
.sty-uploaded {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.sty-subhead {
  margin-block: 1.75rem 1rem;
  padding-block-start: 1.25rem;
  border-top: 1px dashed var(--app-border);
}
.sty-upload {
  margin-block-start: 1rem;
}
.sty-upload input[type='file'] {
  padding: 0.875rem;
  border: 1px dashed var(--app-border);
  border-radius: 0.5rem;
  background: var(--app-canvas);
  color: var(--app-body);
  font: inherit;
  font-size: 0.875rem;
}
</style>
