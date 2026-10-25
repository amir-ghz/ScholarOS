<script setup lang="ts">
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import { getPath, hexToRgb, rgbToHex, setDesign, type DesignField, type FieldGroup } from '../lib/cv-design-fields';

/** `design` is edited in place; an empty field inherits (its placeholder shows what from). */
const props = defineProps<{ groups: FieldGroup[]; design: Record<string, unknown> }>();

const value = (f: DesignField) => getPath(props.design, f.path);
const str = (f: DesignField) => {
  const v = value(f);
  return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
};
const set = (f: DesignField, v: unknown) => setDesign(props.design, f.path, v);
const text = (e: Event) => (e.target as HTMLInputElement).value;
const inherited = (f: DesignField) => f.placeholder === 'true';
const checked = (f: DesignField) => (typeof value(f) === 'boolean' ? (value(f) as boolean) : inherited(f));
/** Back to the inherited value: drop the key, so a later theme or density change still applies. */
const setBool = (f: DesignField, on: boolean) => set(f, on === inherited(f) ? undefined : on);
const setList = (f: DesignField, s: string) =>
  set(
    f,
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );
const swatch = (f: DesignField) => rgbToHex(str(f) || f.placeholder) ?? '#000000';
/** A select's choices: inherit, the listed values, and a value not in the list kept as it is. */
const choices = (f: DesignField) => [
  { value: '', label: `Inherit (${f.placeholder})` },
  ...(f.options ?? []).map((o) => ({ value: o, label: o })),
  ...(str(f) && !f.options?.includes(str(f)) ? [{ value: str(f), label: `${str(f)} (not in list)` }] : []),
];
/** The field's label element id, for controls a <label> can't name (PrimeVue's Select is a combobox span). */
const labelId = (f: DesignField) => `df-${f.path.join('-')}`;
</script>

<template>
  <details v-for="(g, i) in groups" :key="g.group" class="df-group" :open="i === 0">
    <summary>
      <span>{{ g.group }}</span>
      <i class="pi pi-chevron-down df-chevron" aria-hidden="true" />
    </summary>
    <div class="df-fields">
      <template v-for="f in g.fields" :key="f.path.join('.')">
        <label v-if="f.kind === 'boolean'" class="df-check" :title="f.help">
          <Checkbox binary :model-value="checked(f)" @update:model-value="setBool(f, $event)" />
          {{ f.label }}
        </label>
        <div v-else-if="f.kind === 'color'" class="df-field">
          <label :for="labelId(f)">{{ f.label }}</label>
          <div class="df-color">
            <InputText
              :id="labelId(f)"
              type="text"
              size="small"
              :model-value="str(f)"
              :placeholder="f.placeholder"
              :title="f.help"
              fluid
              @update:model-value="set(f, $event)"
            />
            <input
              type="color"
              :value="swatch(f)"
              :aria-label="`${f.label} picker`"
              @input="set(f, hexToRgb(text($event)))"
            />
          </div>
        </div>
        <div v-else-if="f.kind === 'select'" class="df-field">
          <span :id="labelId(f)">{{ f.label }}</span>
          <Select
            :model-value="str(f)"
            :options="choices(f)"
            option-label="label"
            option-value="value"
            size="small"
            :placeholder="`Inherit (${f.placeholder})`"
            :aria-labelledby="labelId(f)"
            :title="f.help"
            fluid
            @update:model-value="set(f, $event)"
          />
        </div>
        <label v-else class="df-field">
          <span>{{ f.label }}</span>
          <InputText
            v-if="f.kind === 'list'"
            type="text"
            size="small"
            :model-value="str(f)"
            :placeholder="f.placeholder"
            :title="f.help ? `${f.help} Comma-separated.` : 'Comma-separated.'"
            fluid
            @change="setList(f, text($event))"
          />
          <InputText
            v-else
            type="text"
            size="small"
            :model-value="str(f)"
            :placeholder="f.placeholder"
            :title="f.help"
            fluid
            @update:model-value="set(f, $event)"
          />
        </label>
      </template>
    </div>
  </details>
</template>

<style scoped>
.df-group {
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  background: var(--app-card);
}
.df-group + .df-group {
  margin-block-start: 0.75rem;
}
.df-group > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 0.625rem;
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
  list-style: none;
  cursor: pointer;
}
.df-group > summary::-webkit-details-marker {
  display: none;
}
.df-group > summary:hover {
  background: var(--app-menu-hover);
}
.df-group[open] > summary {
  border-end-start-radius: 0;
  border-end-end-radius: 0;
  border-bottom: 1px solid var(--app-border);
}
.df-chevron {
  color: var(--app-muted);
  font-size: 0.75rem;
  transition: transform 0.2s;
}
.df-group[open] .df-chevron {
  transform: rotate(180deg);
}
.df-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr));
  gap: 0.875rem 1rem;
  padding: 1rem;
}
.df-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
}
.df-field > span:first-child,
.df-field > label:first-child {
  color: var(--app-heading);
  font-size: 0.8125rem;
  font-weight: 500;
}
.df-check {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 0.5rem;
  color: var(--app-heading);
  font-size: 0.875rem;
}
.df-color {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.df-color input[type='color'] {
  flex: none;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0.125rem;
  border: 1px solid var(--app-border);
  border-radius: 0.5rem;
  background: var(--app-card);
  cursor: pointer;
}
</style>
