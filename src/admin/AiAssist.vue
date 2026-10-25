<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- front matter is user data */
import { ref } from 'vue';
import Button from 'primevue/button';
import Textarea from 'primevue/textarea';
import { api, report, toast } from './api';
import { getIn, setIn } from './fields';
import { HIDE_ICON } from './ui/content/pt';

/** `doc` is the open document; AI results land in it as unsaved edits, so nothing is committed until the owner saves. */
const props = defineProps<{
  collection: 'posts' | 'announcements' | 'publications';
  doc: { data: Record<string, any>; body: string };
  imageKey: 'coverImage' | 'image';
  disabled?: boolean;
}>();
/** The new Markdown body; the parent owns `doc.body`. */
const emit = defineEmits<{ body: [value: string] }>();

/** Publications get a figure only: their body is not written by AI. */
const writes = props.collection !== 'publications';
const instruction = ref('');
const busy = ref<'' | 'write' | 'rewrite' | 'image' | 'motion'>('');
/** The body and image from before the last AI change. */
const before = ref<{ body: string; image: unknown } | null>(null);

const remember = () => (before.value = { body: props.doc.body, image: getIn(props.doc.data, props.imageKey) });

async function run(action: 'write' | 'rewrite') {
  busy.value = action;
  try {
    const { text } = await api<{ text: string }>('ai/text', {
      body: {
        action,
        collection: props.collection,
        instruction: instruction.value,
        title: props.doc.data.title,
        subtitle: props.doc.data.subtitle,
        body: props.doc.body,
      },
    });
    remember();
    emit('body', text);
    toast(`${action === 'write' ? 'Draft written' : 'Rewritten'}: review it, then save`);
  } catch (e) {
    report(e);
  } finally {
    busy.value = '';
  }
}

async function image(motion: boolean) {
  busy.value = motion ? 'motion' : 'image';
  try {
    const { url } = await api<{ url: string }>('ai/image', {
      body: {
        collection: props.collection,
        title: props.doc.data.title,
        excerpt: props.doc.data.excerpt,
        abstract: props.doc.data.abstract,
        motion,
      },
    });
    remember();
    setIn(props.doc.data, props.imageKey, url);
    toast(
      motion
        ? 'Animation generated and saved to the media library as an animated WebP: review it, then save'
        : 'Image generated and added to the media library: review it, then save',
    );
  } catch (e) {
    report(e);
  } finally {
    busy.value = '';
  }
}

function undo() {
  if (!before.value) return;
  emit('body', before.value.body);
  setIn(props.doc.data, props.imageKey, before.value.image);
  before.value = null;
}
</script>

<template>
  <fieldset class="card ai" :disabled="disabled || !!busy">
    <legend class="ai-legend">
      <span class="stat-icon tint-pink ai-icon" aria-hidden="true"><i class="pi pi-sparkles" /></span>
      AI assist
    </legend>
    <label v-if="writes" class="ai-field">
      <span>Instruction (optional)</span>
      <Textarea
        v-model="instruction"
        rows="2"
        auto-resize
        placeholder="e.g. a friendly 300-word summary for non-specialists"
        fluid
      />
    </label>
    <div class="ai-actions">
      <template v-if="writes">
        <Button
          icon="pi pi-pencil"
          :label="busy === 'write' ? 'Writing…' : 'Write'"
          :loading="busy === 'write'"
          size="small"
          severity="secondary"
          outlined
          :pt="HIDE_ICON"
          @click="run('write')"
        />
        <Button
          icon="pi pi-refresh"
          :label="busy === 'rewrite' ? 'Rewriting…' : 'Rewrite'"
          :loading="busy === 'rewrite'"
          size="small"
          severity="secondary"
          outlined
          :pt="HIDE_ICON"
          @click="run('rewrite')"
        />
      </template>
      <Button
        icon="pi pi-image"
        :label="busy === 'image' ? 'Generating…' : 'Generate image'"
        :loading="busy === 'image'"
        size="small"
        severity="secondary"
        outlined
        :pt="HIDE_ICON"
        @click="image(false)"
      />
      <Button
        icon="pi pi-video"
        :label="busy === 'motion' ? 'Animating… (1–3 min)' : 'Generate GIF'"
        :loading="busy === 'motion'"
        size="small"
        severity="secondary"
        outlined
        :pt="HIDE_ICON"
        @click="image(true)"
      />
      <Button v-if="before" icon="pi pi-undo" label="Undo" size="small" text :pt="HIDE_ICON" @click="undo" />
    </div>
  </fieldset>
</template>

<style scoped>
.ai {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
  margin: 0;
  border: 0;
}
/* A legend can't be laid out like a heading; floated, it sits inside the card as one. */
.ai-legend {
  display: flex;
  float: left;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0;
  color: var(--app-heading);
  font-size: 1.125rem;
  font-weight: 600;
}
.ai-legend + * {
  clear: both;
}
.ai-icon {
  width: 2.25rem;
  height: 2.25rem;
  margin: 0;
  font-size: 1rem;
}
.ai-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.ai-field > span {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.ai-field :deep(textarea.p-textarea) {
  padding: var(--p-inputtext-padding-y) var(--p-inputtext-padding-x);
  border-color: var(--p-inputtext-border-color);
  font-size: 0.9375rem;
}
.ai-field :deep(textarea.p-textarea:enabled:focus) {
  border-color: var(--p-inputtext-focus-border-color);
}
.ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
