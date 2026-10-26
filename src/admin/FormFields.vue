<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- form models are user data of any shape */
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import ImagePicker from './ImagePicker.vue';
import ListInput from './ListInput.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import { getIn, optionOf, replaceAt, setIn, type FieldDef, type Option } from './fields';
import { api, ApiError, committed, report, toast, toastError } from './api';
import type { CommitResult, MediaFile } from './types';
import { HIDE_ICON } from './ui/content/pt';
import { bibtexFor, type BibSource } from '../lib/bibtex';
import { isOwner } from '../lib/editorial';

const props = defineProps<{
  fields: FieldDef[];
  model: Record<string, any>;
  errors?: Record<string, string>;
  prefix?: string;
  owner?: string;
}>();

const labelId = (key: string) => `f-${props.prefix ?? ''}${key}`.replace(/[^\w-]/g, '-');
const error = (key: string) => props.errors?.[`${props.prefix ?? ''}${key}`];
const errorId = (key: string) => `${labelId(key)}-error`;
/** Links an input to its error message. */
const invalid = (key: string) => (error(key) ? { 'aria-invalid': 'true', 'aria-describedby': errorId(key) } : {});
const value = (key: string) => getIn(props.model, key);
const set = (key: string, v: unknown) => setIn(props.model, key, v);
const text = (e: Event) => (e.target as HTMLInputElement).value;
const strings = (key: string): string[] => (Array.isArray(value(key)) ? value(key) : []);
const options = (f: FieldDef): Option[] => (f.options ?? []).map(optionOf);
/** Current values missing from the options (e.g. a renamed research area): still shown, so a save keeps them. */
const unlisted = (f: FieldDef, values: unknown[]) =>
  values
    .filter((v) => v != null && v !== '')
    .map(String)
    .filter((v) => !options(f).some((o) => o.value === v));
/** A select's choices: none ("—"), the options, then any current value missing from them. */
const choices = (f: FieldDef, current: unknown): Option[] => [
  { value: '', label: '—' },
  ...options(f),
  ...unlisted(f, [current]).map((v) => ({ value: v, label: `${v} (not in list)` })),
];
const pubChoices = (f: FieldDef): Option[] => [
  ...options(f),
  ...unlisted(f, strings(f.key)).map((v) => ({ value: v, label: `${v} (not in list)` })),
];
/** Selected publications in list order, as the multiple <select> gave them. */
const inListOrder = (f: FieldDef, picked: string[]) =>
  pubChoices(f)
    .map((o) => o.value)
    .filter((v) => picked.includes(v));
const asText = (v: unknown) => (v == null ? '' : String(v));
/** Uploads through the media API (the site folder: a PDF needs a public URL) and sets the field to its URL. */
async function uploadPdf(key: string, e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // choosing the same file again fires `change` again
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  form.append('folder', 'site');
  try {
    const up = await api<MediaFile & { commit: Pick<CommitResult, 'id' | 'url'> | null }>('media', { form });
    if (up.commit) committed(up.commit);
    else toast('That PDF is already uploaded');
    set(key, up.url);
  } catch (err) {
    if (err instanceof ApiError && err.status === 413) toastError('PDFs must be 4 MB or smaller');
    else report(err);
  }
}
/** An `objects` field whose sub-fields are all one line: each item is one row of inputs under a column header. */
const inline = (f: FieldDef) =>
  !!f.fields?.length && f.fields.every((x) => ['text', 'number', 'select'].includes(x.type));
const cellKey = (f: FieldDef, index: number, sub: FieldDef) => `${f.key}.${index}.${sub.key}`;
const regenerate = (key: string) => set(key, bibtexFor({ ...(props.model as BibSource), bibtex: undefined }));
</script>

<template>
  <div class="ff">
    <template v-for="f in fields" :key="f.key">
      <label v-if="f.type === 'checkbox'" class="ff-check">
        <Checkbox
          binary
          :model-value="Boolean(value(f.key) ?? f.default ?? false)"
          @update:model-value="set(f.key, $event)"
        />
        <span>{{ f.label }}</span>
      </label>

      <fieldset v-else-if="f.type === 'objects' && inline(f)" class="ff-rep">
        <legend class="ff-label">{{ f.label }}</legend>
        <div v-if="(value(f.key) ?? []).length" class="ff-rep-head" aria-hidden="true">
          <div class="ff-rep-cols">
            <span v-for="sub in f.fields" :key="sub.key">{{ sub.label }}</span>
          </div>
          <span :class="['ff-rep-spacer', f.fixed ? 'is-2' : 'is-3']" />
        </div>
        <ListInput
          :items="value(f.key) ?? []"
          :blank="() => ({})"
          :fixed="f.fixed"
          add-label="Add item"
          @update="set(f.key, $event)"
        >
          <template #default="{ index }">
            <div class="ff-rep-cols">
              <div v-for="sub in f.fields" :key="sub.key" class="ff-field">
                <Select
                  v-if="sub.type === 'select'"
                  :model-value="asText(value(cellKey(f, index, sub)))"
                  :options="choices(sub, value(cellKey(f, index, sub)))"
                  option-label="label"
                  option-value="value"
                  placeholder="—"
                  :aria-label="`${sub.label} ${index + 1}`"
                  :invalid="!!error(cellKey(f, index, sub))"
                  :pt="{ label: invalid(cellKey(f, index, sub)) }"
                  fluid
                  @update:model-value="set(cellKey(f, index, sub), $event ?? '')"
                />
                <InputText
                  v-else
                  :type="sub.type"
                  :model-value="value(cellKey(f, index, sub)) ?? ''"
                  :aria-label="`${sub.label} ${index + 1}`"
                  :invalid="!!error(cellKey(f, index, sub))"
                  v-bind="invalid(cellKey(f, index, sub))"
                  fluid
                  @input="
                    set(
                      cellKey(f, index, sub),
                      sub.type === 'number' && text($event) !== '' ? Number(text($event)) : text($event),
                    )
                  "
                />
                <span v-if="error(cellKey(f, index, sub))" :id="errorId(cellKey(f, index, sub))" class="ff-err">
                  {{ error(cellKey(f, index, sub)) }}
                </span>
              </div>
            </div>
          </template>
        </ListInput>
      </fieldset>

      <fieldset v-else-if="f.type === 'objects'" class="ff-group">
        <legend>{{ f.label }}</legend>
        <ListInput
          :items="value(f.key) ?? []"
          :blank="() => ({})"
          :fixed="f.fixed"
          add-label="Add item"
          @update="set(f.key, $event)"
        >
          <template #default="{ item, index }">
            <FormFields
              :fields="f.fields ?? []"
              :model="item as Record<string, any>"
              :errors="errors"
              :prefix="`${prefix ?? ''}${f.key}.${index}.`"
              :owner="owner"
            />
          </template>
        </ListInput>
      </fieldset>

      <div
        v-else-if="['list', 'authors', 'image', 'markdown'].includes(f.type)"
        class="ff-field"
        role="group"
        :aria-labelledby="labelId(f.key)"
        v-bind="invalid(f.key)"
      >
        <span :id="labelId(f.key)" class="ff-label">{{ f.label }}</span>
        <ListInput
          v-if="f.type === 'list' || f.type === 'authors'"
          :items="strings(f.key)"
          :blank="() => ''"
          @update="set(f.key, $event)"
        >
          <template #default="{ item, index }">
            <InputText
              :model-value="String(item ?? '')"
              :class="{ 'ff-owner': f.type === 'authors' && !!owner && isOwner(String(item), owner) }"
              :aria-label="`${f.label} ${index + 1}`"
              fluid
              @input="set(f.key, replaceAt(strings(f.key), index, text($event)))"
            />
          </template>
        </ListInput>
        <ImagePicker
          v-else-if="f.type === 'image'"
          :model-value="value(f.key)"
          :folder="f.folder ?? 'content'"
          :label="f.label"
          @update:model-value="set(f.key, $event)"
        />
        <MarkdownEditor v-else :model-value="value(f.key) ?? ''" compact @update:model-value="set(f.key, $event)" />
        <small v-if="f.hint" class="ff-hint">{{ f.hint }}</small>
        <span v-if="error(f.key)" :id="errorId(f.key)" class="ff-err">{{ error(f.key) }}</span>
      </div>

      <div v-else-if="f.type === 'color'" class="ff-field">
        <label :for="labelId(f.key)" class="ff-label">{{ f.label }}</label>
        <div class="ff-inline">
          <InputText
            :id="labelId(f.key)"
            class="ff-color-text"
            :model-value="value(f.key) ?? ''"
            :invalid="!!error(f.key)"
            v-bind="invalid(f.key)"
            @input="set(f.key, text($event))"
          />
          <input
            type="color"
            class="ff-swatch"
            :value="value(f.key) || '#1f3c88'"
            :aria-label="`${f.label} picker`"
            @input="set(f.key, text($event))"
          />
        </div>
        <small v-if="f.hint" class="ff-hint">{{ f.hint }}</small>
        <span v-if="error(f.key)" :id="errorId(f.key)" class="ff-err">{{ error(f.key) }}</span>
      </div>

      <div v-else-if="f.type === 'pdf'" class="ff-field">
        <label :for="labelId(f.key)" class="ff-label">{{ f.label }}</label>
        <div class="ff-inline">
          <InputText
            :id="labelId(f.key)"
            :model-value="value(f.key) ?? ''"
            :invalid="!!error(f.key)"
            v-bind="invalid(f.key)"
            fluid
            @input="set(f.key, text($event))"
          />
          <label class="ff-upload">
            <i class="pi pi-upload" aria-hidden="true" />
            Upload PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              class="adm-visually-hidden"
              aria-label="Upload PDF"
              @change="uploadPdf(f.key, $event)"
            />
          </label>
        </div>
        <span v-if="error(f.key)" :id="errorId(f.key)" class="ff-err">{{ error(f.key) }}</span>
      </div>

      <div v-else-if="f.type === 'select' || f.type === 'pubs'" class="ff-field">
        <span :id="labelId(f.key)" class="ff-label">{{ f.label }}</span>
        <Select
          v-if="f.type === 'select'"
          :model-value="asText(value(f.key))"
          :options="choices(f, value(f.key))"
          option-label="label"
          option-value="value"
          placeholder="—"
          :aria-labelledby="labelId(f.key)"
          :invalid="!!error(f.key)"
          :pt="{ label: invalid(f.key) }"
          fluid
          @update:model-value="set(f.key, $event ?? '')"
        />
        <MultiSelect
          v-else
          :model-value="strings(f.key)"
          :options="pubChoices(f)"
          option-label="label"
          option-value="value"
          :aria-labelledby="labelId(f.key)"
          :invalid="!!error(f.key)"
          :pt="{ labelContainer: invalid(f.key) }"
          display="chip"
          filter
          :max-selected-labels="6"
          fluid
          @update:model-value="set(f.key, inListOrder(f, $event ?? []))"
        />
        <small v-if="f.hint" class="ff-hint">{{ f.hint }}</small>
        <span v-if="error(f.key)" :id="errorId(f.key)" class="ff-err">{{ error(f.key) }}</span>
      </div>

      <label v-else class="ff-field">
        <span class="ff-label">{{ f.label }}</span>
        <Textarea
          v-if="f.type === 'textarea' || f.type === 'bibtex'"
          :model-value="value(f.key) ?? ''"
          :rows="f.type === 'bibtex' ? 8 : 3"
          :class="{ 'ff-mono': f.type === 'bibtex' }"
          :invalid="!!error(f.key)"
          v-bind="invalid(f.key)"
          fluid
          @input="set(f.key, text($event))"
        />
        <InputText
          v-else-if="f.type === 'number'"
          type="number"
          class="ff-number"
          :model-value="value(f.key) ?? ''"
          :invalid="!!error(f.key)"
          v-bind="invalid(f.key)"
          @input="set(f.key, text($event) === '' ? undefined : Number(text($event)))"
        />
        <InputText
          v-else-if="f.type === 'date'"
          type="date"
          class="ff-date"
          :model-value="String(value(f.key) ?? '').slice(0, 10)"
          :invalid="!!error(f.key)"
          v-bind="invalid(f.key)"
          @input="set(f.key, text($event))"
        />
        <output v-else-if="f.type === 'readonly'" class="ff-readonly">{{ value(f.key) }}</output>
        <InputText
          v-else
          :model-value="value(f.key) ?? ''"
          :invalid="!!error(f.key)"
          v-bind="invalid(f.key)"
          fluid
          @input="set(f.key, text($event))"
        />
        <small v-if="f.hint" class="ff-hint">{{ f.hint }}</small>
        <span v-if="error(f.key)" :id="errorId(f.key)" class="ff-err">{{ error(f.key) }}</span>
      </label>
      <Button
        v-if="f.type === 'bibtex'"
        class="ff-regen"
        icon="pi pi-refresh"
        label="Regenerate"
        severity="secondary"
        outlined
        size="small"
        :pt="HIDE_ICON"
        @click="regenerate(f.key)"
      />
    </template>
  </div>
</template>

<style scoped>
.ff {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
  min-width: 0;
}
.ff-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
}
.ff-label,
.ff-group > legend {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.ff-hint {
  color: var(--app-muted);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.ff-err {
  color: var(--c-danger);
  font-size: 0.8125rem;
}
.ff-check {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: fit-content;
  color: var(--app-heading);
  font-size: 0.875rem;
  cursor: pointer;
}
.ff-inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.ff-inline > :first-child {
  flex: 1;
  min-width: 0;
}
.ff .ff-color-text {
  flex: 0 0 calc(12ch + 1.5rem);
}
.ff .ff-swatch {
  flex: none;
  width: 2.75rem;
  height: 2.5rem;
  padding: 0.25rem;
  border: 1px solid var(--p-inputtext-border-color);
  border-radius: var(--p-inputtext-border-radius);
  background: var(--p-inputtext-background);
  cursor: pointer;
}
.ff .ff-number {
  width: calc(10ch + 1.5rem);
}
.ff .ff-date {
  width: 12rem;
  max-width: 100%;
}
.app-dark .ff :is(.ff-date, .ff-swatch) {
  color-scheme: dark;
}
.ff .ff-mono {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}
.ff .ff-owner {
  color: var(--p-primary-color);
  font-weight: 600;
}
.ff-readonly {
  color: var(--app-heading);
  font-weight: 500;
}
.ff-regen {
  align-self: flex-start;
  margin-block-start: -0.5rem;
}
.ff-upload {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.5rem;
  height: 2.5rem;
  padding: 0 0.875rem;
  border: 1px solid var(--p-button-outlined-secondary-border-color, var(--app-border));
  border-radius: var(--p-button-border-radius, 6px);
  color: var(--app-body);
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s;
}
.ff-upload:hover {
  background: var(--app-menu-hover);
}
.ff-upload:focus-within {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}

/* Inline repeater: one row of inputs per item under a column header. */
.ff-rep {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.ff-rep > legend {
  margin-block-end: 0.375rem;
  padding: 0;
}
.ff-rep-cols {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: 0.5rem;
}
.ff-rep-head {
  display: flex;
  gap: 0.5rem;
  color: var(--app-muted);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.ff-rep-head > .ff-rep-cols {
  flex: 1;
}
.ff-rep-spacer.is-2 {
  flex: 0 0 calc(2 * 2.25rem + 0.125rem);
}
.ff-rep-spacer.is-3 {
  flex: 0 0 calc(3 * 2.25rem + 2 * 0.125rem);
}

/* Repeated objects (menu items, page sections, research areas): a soft panel, a rule between entries. */
.ff-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  margin: 0;
  padding: 1rem 1.25rem 1.25rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--app-canvas) 45%, var(--app-card));
}
.ff-group > legend {
  padding: 0 0.375rem;
  font-weight: 600;
}
.ff-group > :deep(.li-list > .li-row + .li-row) {
  padding-block-start: 1rem;
  border-block-start: 1px dashed var(--p-inputtext-border-color);
}

/* The legacy `.adm input` rule (admin.css) would flatten PrimeVue's inputs; keep their own look. */
.ff :deep(:is(input.p-inputtext, textarea.p-textarea)) {
  padding: var(--p-inputtext-padding-y) var(--p-inputtext-padding-x);
  border-color: var(--p-inputtext-border-color);
  border-radius: var(--p-inputtext-border-radius);
  background: var(--p-inputtext-background);
  color: var(--p-inputtext-color);
  font-size: 0.9375rem;
}
.ff :deep(:is(input.p-inputtext, textarea.p-textarea):enabled:hover) {
  border-color: var(--p-inputtext-hover-border-color);
}
.ff :deep(:is(input.p-inputtext, textarea.p-textarea):enabled:focus) {
  border-color: var(--p-inputtext-focus-border-color);
}
.ff :deep(:is(input.p-inputtext, textarea.p-textarea).p-invalid) {
  border-color: var(--p-inputtext-invalid-border-color);
}
.ff :deep(:is(input.p-inputtext, textarea.p-textarea):disabled) {
  background: var(--p-inputtext-disabled-background);
  color: var(--p-inputtext-disabled-color);
}
/* A read-only (MDX) document disables the fieldset around the form; the PrimeVue selects follow it. */
:disabled > .ff :deep(:is(.p-select, .p-multiselect)) {
  pointer-events: none;
  opacity: 0.6;
}
</style>
