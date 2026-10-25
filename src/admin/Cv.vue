<script setup lang="ts">
import {
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type FunctionalComponent,
} from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import DocBanners from './DocBanners.vue';
import FormFields from './FormFields.vue';
import { vDialog } from './dialog';
import { api, committed, report, toast } from './api';
import {
  CV_BLANK,
  CV_FIELDS,
  cvEntryKind,
  cvEntryPreview,
  sectionKey,
  sectionLabel,
  validSectionKey,
  type CvEntryKind,
} from './fields';
import { useDocument } from './useDocument';
import { CV_FONTS, parseInline, plainText, toggleFormat, type CvFont, type InlineFormat } from '../lib/cv-inline';
import type { CvMetadata } from '../lib/types';
import type { AdminCtx, CommitResult, Entry } from './types';

interface CvDoc {
  cv: { name: string; sections?: Record<string, unknown[]>; [key: string]: unknown };
  [key: string]: unknown;
}
interface PendingPublication {
  slug: string;
  data: Record<string, unknown>;
  body: string;
  version: string | null;
}
interface ImportPreview {
  cv: CvDoc;
  publications: PendingPublication[];
  summary: {
    sections: { key: string; count: number }[];
    newPublications: number;
    updatedPublications: number;
    skipped: number;
  };
}
interface Run {
  status: string;
  conclusion: string | null;
  url: string;
}

const props = defineProps<{ ctx: AdminCtx }>();
const doc = useDocument<CvDoc>();
const upload = ref<{ enabled: boolean; version: string | null }>({ enabled: false, version: null });
const publicationCount = ref(0);
const section = ref<string | null>(null);
const index = ref<number | null>(null);
const kind = ref<CvEntryKind>('normal');
const newKind = ref<CvEntryKind>('normal');
const newSection = ref('');
const confirmSection = ref(false);
const confirmEntry = ref(false);
const pending = ref<PendingPublication[]>([]);
const turnOffUpload = ref(false);
const importing = ref(false);
const importText = ref('');
const preview = ref<ImportPreview | null>(null);
const pdf = ref<Run | null>(null);
const pdfMeta = ref<CvMetadata | null>(null);
const generating = ref(false);
// The imported publications and the upload switch belong to the CV draft: keep them across reloads with it.
const IMPORT_KEY = 'scholaros-cv-import';
try {
  const saved = JSON.parse(localStorage.getItem(IMPORT_KEY) ?? 'null');
  if (saved) {
    pending.value = saved.pending ?? [];
    turnOffUpload.value = !!saved.turnOffUpload;
  }
} catch {
  // Storage blocked or corrupt: nothing to restore.
}
watch(
  [pending, turnOffUpload],
  () => {
    try {
      if (pending.value.length || turnOffUpload.value) {
        localStorage.setItem(
          IMPORT_KEY,
          JSON.stringify({ pending: pending.value, turnOffUpload: turnOffUpload.value }),
        );
      } else localStorage.removeItem(IMPORT_KEY);
    } catch {
      // Storage full or blocked: drafts are a convenience.
    }
  },
  { deep: true },
);
function discardDraft() {
  doc.discard();
  pending.value = [];
  turnOffUpload.value = false;
}
let pdfTimer: number | undefined;
let pdfStarted = 0;
let unmounted = false;

const KINDS: [CvEntryKind, string][] = [
  ['normal', 'Normal (name, dates, highlights)'],
  ['experience', 'Experience'],
  ['education', 'Education'],
  ['oneLine', 'One line (label: details)'],
  ['bullet', 'Bullet'],
  ['text', 'Text'],
  ['publication', 'Publication'],
];
const KIND_OPTIONS = KINDS.map(([value, label]) => ({ value, label }));

const sections = computed<Record<string, unknown[]>>(() => doc.current?.cv.sections ?? {});
const keys = computed(() => Object.keys(sections.value));
const entries = computed(() => (section.value ? (sections.value[section.value] ?? []) : []));
const entry = computed(() => (index.value === null ? undefined : entries.value[index.value]));
const entryPreview = computed(() => cvEntryPreview(entry.value));
const pdfLabel = computed(() => {
  if (!pdf.value) return '';
  if (pdf.value.status !== 'completed') return 'PDF: generating…';
  return pdf.value.conclusion === 'success' ? 'PDF: up to date' : `PDF: last run ${pdf.value.conclusion}`;
});

function setSections(next: Record<string, unknown[]>) {
  if (doc.current) doc.current.cv.sections = next;
}

onMounted(async () => {
  await doc.open('config/cv', async () => {
    const { data, version } = await api<{ data: CvDoc; version: string | null }>('config/cv');
    data.cv ??= { name: '' };
    data.cv.sections ??= {};
    return { value: data, version };
  });
  section.value = keys.value[0] ?? null;
  try {
    const [cvUpload, publications] = await Promise.all([
      api<{ data: { enabled?: boolean }; version: string | null }>('config/cv-upload'),
      api<Entry[]>('collections/publications'),
    ]);
    upload.value = { enabled: !!cvUpload.data.enabled, version: cvUpload.version };
    publicationCount.value = publications.length;
  } catch (e) {
    report(e);
  }
  checkPdf();
});
onBeforeUnmount(() => {
  unmounted = true;
  clearTimeout(pdfTimer);
});

// ── Sections ──
function selectSection(key: string | null) {
  section.value = key;
  index.value = null;
  confirmSection.value = false;
  confirmEntry.value = false;
}
const NEEDS_LETTER = 'Section names need at least one letter';
function addSection() {
  if (!newSection.value.trim()) return;
  const key = sectionKey(newSection.value);
  if (!validSectionKey(key)) return toast(NEEDS_LETTER);
  if (key in sections.value) return toast(`There is already a "${sectionLabel(key)}" section`);
  setSections({ ...sections.value, [key]: [] });
  newSection.value = '';
  selectSection(key);
}
function renameSection() {
  if (!section.value) return;
  const name = window.prompt('Section name', sectionLabel(section.value));
  if (!name?.trim()) return;
  const key = sectionKey(name);
  if (!validSectionKey(key)) return toast(NEEDS_LETTER);
  if (key === section.value) return;
  if (key in sections.value) return toast(`There is already a "${sectionLabel(key)}" section`);
  const old = section.value;
  setSections(Object.fromEntries(Object.entries(sections.value).map(([k, v]) => [k === old ? key : k, v])));
  section.value = key;
}
function deleteSection() {
  if (!section.value) return;
  if (!confirmSection.value) {
    confirmSection.value = true;
    return;
  }
  const rest = Object.fromEntries(Object.entries(sections.value).filter(([k]) => k !== section.value));
  setSections(rest);
  selectSection(Object.keys(rest)[0] ?? null);
}

// ── Entries ──
function selectEntry(i: number) {
  index.value = i;
  kind.value = cvEntryKind(entries.value[i]);
  confirmEntry.value = false;
}
function setEntries(list: unknown[]) {
  if (section.value) setSections({ ...sections.value, [section.value]: list });
}
function addEntry() {
  if (!section.value) return;
  const entryKind = entries.value.length ? cvEntryKind(entries.value[0]) : newKind.value;
  setEntries([...entries.value, CV_BLANK[entryKind]()]);
  selectEntry(entries.value.length - 1);
}
function moveEntry(by: number) {
  if (index.value === null) return;
  const to = index.value + by;
  if (to < 0 || to >= entries.value.length) return;
  const list = [...entries.value];
  [list[index.value], list[to]] = [list[to], list[index.value]];
  setEntries(list);
  index.value = to;
}
function deleteEntry() {
  if (index.value === null) return;
  if (!confirmEntry.value) {
    confirmEntry.value = true;
    return;
  }
  setEntries(entries.value.filter((_, i) => i !== index.value));
  index.value = null;
  confirmEntry.value = false;
}
function setText(value: string) {
  if (index.value !== null) setEntries(entries.value.map((e, i) => (i === index.value ? value : e)));
}
function setVisible(visible: boolean) {
  const e = entry.value as Record<string, unknown> | undefined;
  if (!e || typeof e !== 'object') return;
  if (visible) delete e.visible;
  else e.visible = false;
}

// ── Inline formatting (the bar above the entry fields) ──
type TextField = HTMLInputElement | HTMLTextAreaElement;
const isTextField = (t: EventTarget | null): t is TextField =>
  t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type === 'text');
/** The entry field focused last; the bar keeps acting on it while its own font select has focus. */
const field = shallowRef<TextField | null>(null);
const font = ref('');
const FONTS = Object.entries(CV_FONTS) as [CvFont, (typeof CV_FONTS)[CvFont]][];
watch([section, index], () => (field.value = null));
function onFocusIn(e: FocusEvent) {
  if (isTextField(e.target)) field.value = e.target;
}
function onFocusOut(e: FocusEvent) {
  const to = e.relatedTarget as Node | null;
  if (!to || !(e.currentTarget as HTMLElement).contains(to)) field.value = null;
}
/** Writes through the field's own input event, so the form's usual path (dirty state, validation) sees it. */
async function applyFormat(format: InlineFormat) {
  const el = field.value;
  if (!el?.isConnected) return;
  const r = toggleFormat(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0, format);
  el.value = r.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  await nextTick();
  el.setSelectionRange(r.start, r.end);
}
function applyFont() {
  const choice = font.value;
  font.value = '';
  if (choice) void applyFormat({ font: choice === 'default' ? null : (choice as CvFont) });
}
function onFormatKey(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || !isTextField(e.target)) return;
  const format = ({ b: 'bold', i: 'italic', k: 'link' } as const)[e.key.toLowerCase()];
  if (!format) return;
  e.preventDefault();
  void applyFormat(format);
}
/** CV markup as the site renders it: strong, em, a font family, a link. */
const CvInline: FunctionalComponent<{ text: string }> = ({ text }) =>
  parseInline(text).map(({ text, bold, italic, font, href }) => {
    let node: ReturnType<typeof h> | string = text;
    if (italic) node = h('em', node);
    if (bold) node = h('strong', node);
    if (font) node = h('span', { style: { fontFamily: CV_FONTS[font].css } }, node);
    return href ? h('a', { href, target: '_blank', rel: 'noopener' }, node) : node;
  });
CvInline.props = ['text'];

// ── Publish ──
async function publish() {
  const result = await doc.save(
    (cv, cvVersion) =>
      api<CommitResult>('cv/publish', {
        method: 'POST',
        body: {
          cv,
          cvVersion,
          publications: pending.value,
          ...(turnOffUpload.value ? { uploadVersion: upload.value.version } : {}),
        },
      }),
    'config/cv.yml',
  );
  if (!result) return;
  if (props.ctx.mode === 'postgres') void checkPdf(); // the save regenerated it
  publicationCount.value += pending.value.filter((p) => !p.version).length;
  pending.value = [];
  if (turnOffUpload.value) {
    upload.value = { enabled: false, version: result.versions['config/cv-upload.yml'] ?? null };
    turnOffUpload.value = false;
  }
}

// ── Import ──
async function readFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) importText.value = await file.text();
}
async function previewImport() {
  preview.value = null;
  try {
    preview.value = await api<ImportPreview>('cv/import', { body: { yaml: importText.value } });
  } catch (e) {
    report(e);
  }
}
function applyImport() {
  if (!preview.value) return;
  const cv = preview.value.cv;
  doc.current = { ...cv, cv: { ...cv.cv, sections: cv.cv.sections ?? {} } };
  pending.value = preview.value.publications;
  turnOffUpload.value = upload.value.enabled;
  selectSection(Object.keys(doc.current.cv.sections ?? {})[0] ?? null);
  closeImport();
  toast('Imported into the editor. Review it, then click Publish.');
}
function closeImport() {
  importing.value = false;
  preview.value = null;
  importText.value = '';
}

/** History restore and conflict reload: the document and the PDF info both changed. */
async function reloadCv() {
  await doc.reload();
  void checkPdf();
}

// ── PDF (GitHub Actions: render-cv.yml) ──
async function checkPdf() {
  if (props.ctx.mode === 'postgres') {
    try {
      pdfMeta.value = (await api<{ pdf: CvMetadata | null }>('cv/pdf')).pdf;
    } catch (e) {
      report(e);
    }
    return;
  }
  try {
    const { run } = await api<{ run: Run | null }>('cv/pdf');
    pdf.value = run;
    const justStarted = Date.now() - pdfStarted < 60_000; // a new run takes a moment to appear
    if (unmounted) return;
    if ((run && run.status !== 'completed') || justStarted) pdfTimer = window.setTimeout(checkPdf, 5000);
  } catch (e) {
    report(e);
  }
}
async function generatePdf() {
  if (props.ctx.mode === 'postgres') {
    generating.value = true;
    try {
      const result = await api<{ pdf: CvMetadata; warning?: 'cache-purge-failed'; tags?: string[] }>('cv/pdf', {
        method: 'POST',
      });
      pdfMeta.value = result.pdf;
      if (result.warning) committed(result);
      else toast('PDF updated', pdfMeta.value.pdfPath);
    } catch (e) {
      report(e);
    } finally {
      generating.value = false;
    }
    return;
  }
  try {
    await api('cv/pdf', { method: 'POST' });
    pdfStarted = Date.now();
    toast('PDF generation started on GitHub Actions');
    clearTimeout(pdfTimer);
    if (!unmounted) pdfTimer = window.setTimeout(checkPdf, 4000);
  } catch (e) {
    report(e);
  }
}
</script>

<template>
  <AdminShell :ctx="ctx" active="cv" title="CV" :dirty="doc.dirty">
    <template #actions>
      <span v-if="pdf" class="cv-pdf">{{ pdfLabel }} · <a :href="pdf.url" target="_blank" rel="noopener">run</a></span>
      <Button icon="pi pi-file-import" label="Import YAML" severity="secondary" outlined @click="importing = true" />
      <span v-if="pdfMeta" class="cv-pdf"
        >PDF: {{ new Date(pdfMeta.lastGenerated).toLocaleString() }} ·
        <a :href="pdfMeta.pdfPath" target="_blank" rel="noopener">open</a></span
      >
      <Button
        icon="pi pi-file-pdf"
        :label="generating ? 'Generating…' : 'Generate PDF'"
        severity="secondary"
        outlined
        :loading="generating"
        @click="generatePdf"
      />
      <Button icon="pi pi-check" label="Publish" :disabled="doc.saving || !doc.current" @click="publish" />
    </template>
    <AdminTabLinks
      v-if="ctx.mode !== 'static'"
      label="CV"
      :tabs="[
        { href: `/${ctx.adminPath}/cv`, label: 'Entries', current: true },
        { href: `/${ctx.adminPath}/cv-styles`, label: 'Styles' },
      ]"
    />

    <div class="cv-notes">
      <p v-if="upload.enabled && !turnOffUpload" class="cv-note">
        <i class="pi pi-info-circle" aria-hidden="true" />
        <span
          >A raw RenderCV upload (config/cv-upload.yml) is turned on and replaces this CV on the site. Importing YAML
          here turns the upload off.</span
        >
      </p>
      <p v-if="turnOffUpload" class="cv-note">
        <i class="pi pi-info-circle" aria-hidden="true" />
        <span>Publishing will turn off the raw RenderCV upload.</span>
      </p>
      <p v-if="pending.length" class="cv-note">
        <i class="pi pi-info-circle" aria-hidden="true" />
        <span>{{ pending.length }} publication(s) from the import will be saved to Publications when you publish.</span>
      </p>
      <DocBanners
        :draft="!!doc.draft"
        :path="'config/cv.yml'"
        :version="doc.version"
        :conflict="doc.conflict"
        :stale="doc.draftStale ? doc.draftChanges : null"
        @restore="doc.restore()"
        @discard="discardDraft"
        @reload="reloadCv"
      />
    </div>

    <div v-if="doc.current" class="cv-cols">
      <section aria-label="Sections" class="card cv-sections">
        <div class="card-head cv-head">
          <h2 class="card-title"><i class="pi pi-list text-primary" aria-hidden="true" /> Sections</h2>
        </div>
        <ul class="cv-pick">
          <li v-for="key in keys" :key="key">
            <button type="button" :aria-current="section === key" @click="selectSection(key)">
              <span class="cv-pick-label">{{ sectionLabel(key) }}</span
              ><span class="cv-count">{{ sections[key].length }}</span>
            </button>
          </li>
        </ul>
        <ul class="cv-pick cv-pick-link">
          <li>
            <a :href="`/${ctx.adminPath}/publications`"
              ><span class="cv-pick-label">Publications collection ↗</span
              ><span class="cv-count">{{ publicationCount }}</span></a
            >
          </li>
        </ul>
        <div class="cv-add">
          <InputText
            v-model="newSection"
            type="text"
            size="small"
            placeholder="New section"
            aria-label="New section name"
            fluid
            @keydown.enter="addSection"
          />
          <Button icon="pi pi-plus" label="Add" size="small" severity="secondary" outlined @click="addSection" />
        </div>
        <div v-if="section" class="cv-actions">
          <Button
            icon="pi pi-pencil"
            label="Rename"
            size="small"
            severity="secondary"
            outlined
            @click="renameSection"
          />
          <Button
            icon="pi pi-trash"
            :label="confirmSection ? 'Click again to delete' : 'Delete section'"
            size="small"
            severity="danger"
            :outlined="!confirmSection"
            @click="deleteSection"
          />
        </div>
      </section>

      <section aria-label="Entries" class="card cv-entries">
        <div class="card-head cv-head">
          <h2 class="card-title">
            <i class="pi pi-bars text-primary" aria-hidden="true" />
            {{ section ? sectionLabel(section) : 'Entries' }}
          </h2>
        </div>
        <ul class="cv-pick">
          <li v-for="(e, i) in entries" :key="i">
            <button type="button" :aria-current="index === i" @click="selectEntry(i)">
              <span class="cv-pick-label">{{ plainText(cvEntryPreview(e).title) || '(untitled)' }}</span>
              <span v-if="(e as any)?.visible === false" class="chip chip-secondary">hidden</span>
            </button>
          </li>
        </ul>
        <p v-if="section && !entries.length" class="cv-empty">No entries yet.</p>
        <div v-if="section" class="cv-actions">
          <Select
            v-if="!entries.length"
            v-model="newKind"
            :options="KIND_OPTIONS"
            option-label="label"
            option-value="value"
            size="small"
            aria-label="Entry type"
            fluid
          />
          <Button label="+ Entry" size="small" @click="addEntry" />
          <template v-if="index !== null">
            <Button
              icon="pi pi-arrow-up"
              size="small"
              severity="secondary"
              outlined
              aria-label="Move entry up"
              @click="moveEntry(-1)"
            />
            <Button
              icon="pi pi-arrow-down"
              size="small"
              severity="secondary"
              outlined
              aria-label="Move entry down"
              @click="moveEntry(1)"
            />
            <Button
              icon="pi pi-trash"
              :label="confirmEntry ? 'Click again to delete' : 'Delete'"
              size="small"
              severity="danger"
              :outlined="!confirmEntry"
              @click="deleteEntry"
            />
          </template>
        </div>
      </section>

      <section
        aria-label="Entry"
        class="card cv-entry"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
        @keydown="onFormatKey"
      >
        <div class="card-head cv-head">
          <h2 class="card-title"><i class="pi pi-pen-to-square text-primary" aria-hidden="true" /> Entry</h2>
        </div>
        <template v-if="entry !== undefined && section && index !== null">
          <div class="cv-format" role="toolbar" aria-label="Text formatting">
            <button
              type="button"
              title="Bold (⌘B / Ctrl+B)"
              aria-label="Bold"
              :disabled="!field"
              @mousedown.prevent
              @click="applyFormat('bold')"
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              title="Italic (⌘I / Ctrl+I)"
              aria-label="Italic"
              :disabled="!field"
              @mousedown.prevent
              @click="applyFormat('italic')"
            >
              <em>I</em>
            </button>
            <button
              type="button"
              title="Link (⌘K / Ctrl+K)"
              aria-label="Link"
              :disabled="!field"
              @mousedown.prevent
              @click="applyFormat('link')"
            >
              <i class="pi pi-link" aria-hidden="true" /> Link
            </button>
            <span class="cv-format-sep" aria-hidden="true" />
            <select
              v-model="font"
              title="Font of the selected text"
              aria-label="Font"
              :disabled="!field"
              @change="applyFont"
            >
              <option value="" disabled>Font</option>
              <option value="default">Default</option>
              <option v-for="[key, f] in FONTS" :key="key" :value="key">{{ f.label }}</option>
            </select>
          </div>
          <label v-if="kind === 'text'" class="cv-field">
            <span>Text</span>
            <Textarea :model-value="String(entry)" rows="5" fluid @update:model-value="setText" />
          </label>
          <template v-else>
            <label class="cv-check">
              <Checkbox
                binary
                :model-value="(entry as any).visible !== false"
                @update:model-value="setVisible($event)"
              />
              Visible
            </label>
            <FormFields
              :fields="CV_FIELDS[kind as Exclude<CvEntryKind, 'text'>]"
              :model="entry as Record<string, any>"
              :errors="doc.errors"
              :prefix="`cv.sections.${section}.${index}.`"
              :owner="ctx.siteName"
            />
          </template>
          <section class="cv-preview" aria-label="Preview">
            <strong v-if="entryPreview.title" class="cv-preview-title"><CvInline :text="entryPreview.title" /></strong>
            <strong v-else class="cv-preview-title">(untitled)</strong>
            <div v-if="entryPreview.org" class="cv-preview-sub"><CvInline :text="entryPreview.org" /></div>
            <div v-if="entryPreview.when" class="cv-preview-sub">{{ entryPreview.when }}</div>
            <ul v-if="entryPreview.points.length">
              <li v-for="(point, i) in entryPreview.points" :key="i"><CvInline :text="point" /></li>
            </ul>
          </section>
        </template>
        <div v-else class="empty-state">
          <i class="pi pi-pen-to-square" aria-hidden="true" />
          <p class="cv-empty">Choose an entry.</p>
        </div>
      </section>
    </div>

    <div
      v-if="importing"
      v-dialog
      class="cv-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adm-import-title"
      @keydown.esc="closeImport"
    >
      <div class="cv-modal-box">
        <h2 id="adm-import-title" class="card-title">Import a RenderCV YAML file</h2>
        <p class="cv-modal-text">
          The import replaces the CV in this editor and moves publication sections into Publications. Papers that
          already exist are updated, not duplicated. Nothing is saved until you click Publish.
        </p>
        <input
          type="file"
          class="cv-file"
          accept=".yaml,.yml,text/yaml"
          aria-label="RenderCV file"
          @change="readFile"
        />
        <label class="cv-field">
          <span>Or paste the YAML</span>
          <Textarea v-model="importText" rows="10" fluid class="cv-mono" />
        </label>
        <div v-if="preview" class="cv-import-preview">
          <p>
            <strong>{{ preview.cv.cv.name }}</strong>
          </p>
          <ul>
            <li v-for="s in preview.summary.sections" :key="s.key">{{ sectionLabel(s.key) }}: {{ s.count }}</li>
          </ul>
          <p>
            Publications: {{ preview.summary.newPublications }} new,
            {{ preview.summary.updatedPublications }} updated<span v-if="preview.summary.skipped"
              >, {{ preview.summary.skipped }} skipped (MDX or duplicate)</span
            >.
          </p>
        </div>
        <div class="cv-modal-actions">
          <Button v-if="!preview" label="Preview" :disabled="!importText.trim()" @click="previewImport" />
          <Button v-else label="Apply to editor" @click="applyImport" />
          <Button label="Cancel" severity="secondary" outlined @click="closeImport" />
        </div>
      </div>
    </div>
  </AdminShell>
</template>

<style scoped>
.cv-pdf {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.cv-notes {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-block: 1.25rem;
}
.cv-notes:empty {
  display: none;
}
.cv-note {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  margin: 0;
  padding: 0.875rem 1rem;
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--c-warning) 12%, var(--app-card));
  box-shadow: inset 4px 0 0 var(--c-warning);
  color: var(--app-heading);
  font-size: 0.875rem;
}
.cv-note .pi {
  margin-block-start: 0.2rem;
  color: #b56605;
}
:global(.app-dark) .cv-note .pi {
  color: #f7a23a;
}

/* Three cards: sections, the open section's entries, the open entry. */
.cv-cols {
  display: grid;
  grid-template-columns: minmax(0, 17rem) minmax(0, 18rem) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}
@media (max-width: 1399.98px) {
  .cv-cols {
    grid-template-columns: minmax(0, 17rem) minmax(0, 1fr);
    grid-template-rows: auto 1fr;
  }
  .cv-entry {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
}
@media (max-width: 767.98px) {
  .cv-cols {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: none;
  }
  .cv-entry {
    grid-column: auto;
    grid-row: auto;
  }
}
.cv-cols > .card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
}
.cv-head {
  margin: 0;
}
.cv-head .card-title {
  font-size: 1rem;
}

.cv-pick {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cv-pick button,
.cv-pick a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5625rem 0.75rem;
  border: 0;
  border-radius: 0.5rem;
  background: none;
  color: var(--app-heading);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: start;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s;
}
.cv-pick button:hover,
.cv-pick a:hover {
  background: var(--app-menu-hover);
  text-decoration: none;
}
.cv-pick button[aria-current='true'] {
  background: color-mix(in srgb, var(--p-primary-color) 10%, transparent);
  color: var(--p-primary-color);
}
.cv-pick-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.cv-count {
  display: inline-grid;
  flex: none;
  place-items: center;
  min-width: 1.5rem;
  height: 1.375rem;
  padding: 0 0.375rem;
  border-radius: 999px;
  background: var(--app-canvas);
  color: var(--app-muted);
  font-size: 0.75rem;
  font-weight: 600;
}
.cv-pick button[aria-current='true'] .cv-count {
  background: var(--p-primary-color);
  color: #fff;
}
.cv-pick-link {
  padding-block-start: 0.75rem;
  border-top: 1px dashed var(--app-border);
}
.cv-pick-link a {
  color: var(--p-primary-color);
}
.cv-add {
  display: flex;
  gap: 0.5rem;
}
.cv-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.cv-empty {
  margin: 0;
  color: var(--app-muted);
  font-size: 0.875rem;
}

/* The entry's formatting bar (Conca's editor toolbar). */
.cv-format {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem;
  border: 1px solid var(--app-border);
  border-radius: 0.5rem;
  background: var(--app-canvas);
}
.cv-format button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.5rem;
  border: 0;
  border-radius: 0.375rem;
  background: none;
  color: var(--app-heading);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}
.cv-format button:hover:not(:disabled) {
  background: var(--app-card);
  box-shadow: var(--app-shadow-card);
}
.cv-format button:disabled,
.cv-format select:disabled {
  opacity: 0.45;
  cursor: default;
}
.cv-format .pi {
  font-size: 0.8125rem;
}
.cv-format-sep {
  width: 1px;
  height: 1.25rem;
  margin-inline: 0.25rem;
  background: var(--app-border);
}
.cv-format select {
  width: auto;
  height: 2rem;
  padding: 0 0.5rem;
  border: 1px solid var(--app-border);
  border-radius: 0.375rem;
  background: var(--app-card);
  color: var(--app-heading);
  font: inherit;
  font-size: 0.8125rem;
}
.cv-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.cv-field > span:first-child {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.cv-check {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.cv-preview {
  padding: 1rem 1.25rem;
  border: 1px dashed color-mix(in srgb, var(--p-primary-color) 35%, var(--app-border));
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--p-primary-color) 4%, var(--app-card));
  color: var(--app-heading);
  font-size: 0.9375rem;
}
.cv-preview-title {
  display: block;
  font-weight: 600;
}
.cv-preview-sub {
  color: var(--app-muted);
  font-size: 0.875rem;
}
.cv-preview ul {
  margin: 0.5rem 0 0;
  list-style: disc;
  padding-inline-start: 1.25rem;
  color: var(--app-body);
  font-size: 0.875rem;
}
.cv-entry .empty-state p {
  margin: 0;
}

/* Import dialog. */
.cv-modal {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(25 24 34 / 0.45);
  backdrop-filter: blur(2px);
}
.cv-modal-box {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: min(720px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 1.5rem;
  border-radius: var(--app-radius-card);
  background: var(--app-card);
  box-shadow: var(--app-shadow-float);
}
.cv-modal-text {
  margin: 0;
  color: var(--app-body);
  font-size: 0.875rem;
}
.cv-file {
  padding: 0.75rem;
  border: 1px dashed var(--app-border);
  border-radius: 0.5rem;
  background: var(--app-canvas);
  color: var(--app-body);
  font: inherit;
  font-size: 0.875rem;
}
.cv-mono {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}
.cv-import-preview {
  padding: 1rem;
  border-radius: 0.625rem;
  background: var(--app-canvas);
  color: var(--app-heading);
  font-size: 0.875rem;
}
.cv-import-preview p,
.cv-import-preview ul {
  margin: 0;
}
.cv-import-preview ul {
  margin-block: 0.375rem;
  list-style: disc;
  padding-inline-start: 1.25rem;
}
.cv-modal-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
