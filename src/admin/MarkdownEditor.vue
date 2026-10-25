<script setup lang="ts">
import { Editor, type ChainedCommands } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import 'katex/dist/katex.min.css';
import { ref, watch } from 'vue';
import Button from 'primevue/button';
import MediaGrid from './MediaGrid.vue';
import { editorExtensions, isLossless } from './editor/extensions';
import ContentModal from './ui/content/ContentModal.vue';
import { HIDE_ICON } from './ui/content/pt';

const props = defineProps<{ modelValue: string; compact?: boolean; preview?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const host = ref<HTMLElement>();
const picking = ref(false);
const slash = ref<{ top: number; left: number } | null>(null);
// In preview the content takes the public post styles (.ed-prose from editorial.css).
const contentClass = (preview?: boolean) => (preview ? 'tiptap ed-prose' : 'tiptap');

function editMath(kind: 'inline' | 'block', node: PMNode, pos: number) {
  const latex = window.prompt('LaTeX', String(node.attrs.latex ?? ''));
  if (latex === null || !editor.value) return;
  const chain = editor.value.chain().setNodeSelection(pos);
  (kind === 'inline' ? chain.updateInlineMath({ latex }) : chain.updateBlockMath({ latex })).focus().run();
}

// Markdown the editor can't represent (HTML, comments, footnotes, …) is edited as plain text instead of being rewritten.
const headless = (markdown: string) =>
  new Editor({ extensions: editorExtensions(), content: markdown, contentType: 'markdown' });
const plain = ref(!isLossless(props.modelValue, headless));
let emitted: string | undefined;
function emitMarkdown(markdown: string) {
  emitted = markdown;
  emit('update:modelValue', markdown);
}

const editor = useEditor({
  extensions: editorExtensions(editMath),
  content: props.modelValue,
  contentType: 'markdown',
  editable: !props.preview,
  editorProps: { attributes: { class: contentClass(props.preview) } },
  onUpdate: ({ editor: e }) => {
    emitMarkdown(e.getMarkdown());
    updateSlash();
  },
  onSelectionUpdate: () => updateSlash(),
});

watch(
  () => props.modelValue,
  (markdown) => {
    // Our own edit coming back is skipped once; any other change (reload, restore, another entry) is applied.
    const echo = markdown === emitted;
    emitted = undefined;
    if (echo) return;
    plain.value = !isLossless(markdown, headless);
    if (!plain.value && editor.value && markdown !== editor.value.getMarkdown()) {
      editor.value.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
    }
  },
);
watch(
  () => props.preview,
  (preview) => {
    editor.value?.setEditable(!preview);
    editor.value?.setOptions({ editorProps: { attributes: { class: contentClass(preview) } } });
  },
);

function run(command: (chain: ChainedCommands) => ChainedCommands) {
  if (editor.value) command(editor.value.chain().focus()).run();
}

function link() {
  const previous = editor.value?.getAttributes('link').href as string | undefined;
  const href = window.prompt('Link URL (leave empty to remove the link)', previous ?? 'https://');
  if (href === null) return;
  run((c) => (href ? c.extendMarkRange('link').setLink({ href }) : c.extendMarkRange('link').unsetLink()));
}

function equation(block: boolean) {
  const latex = window.prompt(block ? 'LaTeX (display equation)' : 'LaTeX', '');
  if (latex) run((c) => (block ? c.insertBlockMath({ latex }) : c.insertInlineMath({ latex })));
}

function insertImage(url: string) {
  picking.value = false;
  const alt = window.prompt('Alt text: describe the image for screen readers', '') ?? '';
  run((c) => c.setImage({ src: url, alt }));
}

type Active = string | [string, Record<string, unknown>];
const TOOLBAR: { label: string; title: string; active?: Active; action: () => void }[] = [
  { label: 'B', title: 'Bold', active: 'bold', action: () => run((c) => c.toggleBold()) },
  { label: 'I', title: 'Italic', active: 'italic', action: () => run((c) => c.toggleItalic()) },
  {
    label: 'H',
    title: 'Heading',
    active: ['heading', { level: 2 }],
    action: () => run((c) => c.toggleHeading({ level: 2 })),
  },
  { label: '❝', title: 'Quote', active: 'blockquote', action: () => run((c) => c.toggleBlockquote()) },
  { label: 'Link', title: 'Link', active: 'link', action: link },
  { label: '•', title: 'List', active: 'bulletList', action: () => run((c) => c.toggleBulletList()) },
  { label: '</>', title: 'Code', active: 'code', action: () => run((c) => c.toggleCode()) },
  { label: '∑', title: 'Equation', action: () => equation(false) },
  { label: 'Img', title: 'Image', action: () => (picking.value = true) },
];
/** Toolbar buttons drawn as icons (the rest keep their letter or symbol), and where a group ends. */
const ICON: Record<string, string> = { Link: 'pi-link', List: 'pi-list', Code: 'pi-code', Image: 'pi-image' };
const GROUP_END = new Set(['Heading', 'Link', 'Code']);
const isActive = (a?: Active) =>
  !!a && !!editor.value && (Array.isArray(a) ? editor.value.isActive(a[0], a[1]) : editor.value.isActive(a));

const SLASH: [string, () => void][] = [
  ['Heading', () => run((c) => c.setNode('heading', { level: 2 }))],
  ['Quote', () => run((c) => c.setBlockquote())],
  ['Code block', () => run((c) => c.setCodeBlock())],
  ['Equation', () => equation(true)],
  ['Image', () => (picking.value = true)],
  ['Table', () => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))],
];

/** The "/" menu opens when an empty paragraph holds just "/". */
function updateSlash() {
  const ed = editor.value;
  if (!ed || props.compact || !host.value) return;
  const { $from, empty } = ed.state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.textContent !== '/') {
    slash.value = null;
    return;
  }
  const at = ed.view.coordsAtPos($from.pos);
  const box = host.value.getBoundingClientRect();
  slash.value = { top: at.bottom - box.top + 4, left: at.left - box.left };
}

function choose(action: () => void) {
  const ed = editor.value;
  if (!ed) return;
  const { $from } = ed.state.selection;
  ed.chain()
    .focus()
    .deleteRange({ from: $from.pos - 1, to: $from.pos })
    .run();
  slash.value = null;
  action();
}
</script>

<template>
  <div ref="host" class="md" :class="{ 'is-compact': compact, 'is-preview': preview }" @keydown.esc="slash = null">
    <template v-if="plain">
      <p class="md-plain-note" role="status">
        <i class="pi pi-info-circle" aria-hidden="true" />
        <span
          >This text uses Markdown the visual editor can't keep (HTML, footnotes, …). Editing it as plain Markdown so
          nothing is lost.</span
        >
      </p>
      <textarea
        class="md-plain"
        aria-label="Markdown"
        :value="modelValue"
        :readonly="preview"
        @input="emitMarkdown(($event.target as HTMLTextAreaElement).value)"
      ></textarea>
    </template>
    <div v-if="!preview && !plain" class="md-toolbar" role="toolbar" aria-label="Formatting">
      <template v-for="t in TOOLBAR" :key="t.title">
        <button
          type="button"
          class="md-tool"
          :class="[{ 'is-active': isActive(t.active) }, `md-tool-${t.title.toLowerCase()}`]"
          :title="t.title"
          :aria-label="t.title"
          @click="t.action"
        >
          <i v-if="ICON[t.title]" :class="['pi', ICON[t.title]]" aria-hidden="true" />
          <template v-else>{{ t.label }}</template>
        </button>
        <span v-if="GROUP_END.has(t.title)" class="md-sep" aria-hidden="true" />
      </template>
    </div>
    <EditorContent v-show="!plain" :editor="editor" />
    <div v-if="slash" class="md-slash" role="menu" :style="{ top: `${slash.top}px`, left: `${slash.left}px` }">
      <button
        v-for="[label, action] in SLASH"
        :key="label"
        type="button"
        role="menuitem"
        @mousedown.prevent="choose(action)"
      >
        {{ label }}
      </button>
    </div>
    <ContentModal v-if="picking" wide aria-label="Insert an image" @keydown.esc="picking = false">
      <div class="md-modal-head">
        <h2>Insert an image</h2>
        <Button
          icon="pi pi-times"
          label="Close"
          severity="secondary"
          text
          size="small"
          :pt="HIDE_ICON"
          @click="picking = false"
        />
      </div>
      <MediaGrid folder="site" pickable @pick="insertImage" />
    </ContentModal>
  </div>
</template>

<style scoped>
.md {
  position: relative;
  min-width: 0;
  border: 1px solid var(--p-inputtext-border-color, var(--app-border));
  border-radius: 0.625rem;
  background: var(--app-card);
  transition: border-color 0.15s;
}
.md:focus-within {
  border-color: var(--p-primary-color);
}
.md.is-preview {
  border-style: dashed;
}
.md-toolbar {
  position: sticky;
  inset-block-start: var(--app-header-height, 0);
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.125rem;
  padding: 0.375rem 0.5rem;
  border-block-end: 1px solid var(--app-border);
  border-start-start-radius: inherit;
  border-start-end-radius: inherit;
  background: color-mix(in srgb, var(--app-canvas) 55%, var(--app-card));
}
.md-tool {
  display: inline-grid;
  place-items: center;
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.375rem;
  border: 0;
  border-radius: 0.375rem;
  background: none;
  color: var(--app-body);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.md-tool:hover {
  background: var(--app-menu-hover);
  color: var(--app-heading);
}
.md-tool.is-active {
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  color: var(--p-primary-color);
}
.md-tool:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 0;
}
.md-tool-italic {
  font-family: var(--font-serif, Georgia, serif);
  font-style: italic;
}
.md-tool .pi {
  font-size: 0.875rem;
}
.md-sep {
  width: 1px;
  height: 1.25rem;
  margin-inline: 0.25rem;
  background: var(--app-border);
}
.md :deep(.tiptap) {
  min-height: 320px;
  padding: 1rem 1.25rem;
  color: var(--app-heading);
  outline: none;
}
.md.is-compact :deep(.tiptap) {
  min-height: 140px;
}
.md :deep(.tiptap > :first-child) {
  margin-block-start: 0;
}
/* Editing view: the admin's reset strips headings and lists, so the text gets light prose styles back. */
.md :deep(.tiptap:not(.ed-prose)) {
  line-height: 1.65;
}
.md :deep(.tiptap:not(.ed-prose) :is(p, ul, ol, blockquote, pre, table)) {
  margin-block: 0 0.75rem;
}
.md :deep(.tiptap:not(.ed-prose) :is(h1, h2, h3, h4)) {
  margin-block: 1.25rem 0.5rem;
  color: var(--app-heading);
  font-weight: 600;
  line-height: 1.3;
}
.md :deep(.tiptap:not(.ed-prose) h1) {
  font-size: 1.5rem;
}
.md :deep(.tiptap:not(.ed-prose) h2) {
  font-size: 1.3125rem;
}
.md :deep(.tiptap:not(.ed-prose) :is(h3, h4)) {
  font-size: 1.0625rem;
}
.md :deep(.tiptap:not(.ed-prose) ul) {
  padding-inline-start: 1.375rem;
  list-style: disc;
}
.md :deep(.tiptap:not(.ed-prose) ol) {
  padding-inline-start: 1.375rem;
  list-style: decimal;
}
.md :deep(.tiptap:not(.ed-prose) li > p) {
  margin: 0;
}
.md :deep(.tiptap:not(.ed-prose) a) {
  color: var(--p-primary-color);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.md :deep(.tiptap:not(.ed-prose) pre) {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: var(--app-canvas);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  white-space: pre-wrap;
}
.md :deep(.tiptap:not(.ed-prose) pre code) {
  padding: 0;
  background: none;
}
.md :deep(.tiptap table) {
  border-collapse: collapse;
}
.md :deep(.tiptap :is(td, th)) {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--app-border);
}
.md :deep(.tiptap img) {
  max-width: 100%;
}
.md :deep(.tiptap blockquote) {
  margin-inline: 0;
  padding-inline-start: 1rem;
  border-inline-start: 3px solid color-mix(in srgb, var(--p-primary-color) 40%, transparent);
  color: var(--app-body);
}
.md :deep(.tiptap code) {
  padding: 0.0625rem 0.3125rem;
  border-radius: 0.25rem;
  background: var(--app-canvas);
  font-size: 0.875em;
}
.md-plain-note {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0;
  padding: 0.75rem 1rem;
  border-block-end: 1px solid color-mix(in srgb, var(--c-warning) 30%, var(--app-border));
  border-start-start-radius: inherit;
  border-start-end-radius: inherit;
  background: color-mix(in srgb, var(--c-warning) 10%, var(--app-card));
  color: var(--app-heading);
  font-size: 0.8125rem;
}
.md-plain-note .pi {
  margin-block-start: 0.1875rem;
  color: var(--c-warning);
}
.md .md-plain {
  display: block;
  width: 100%;
  min-height: 320px;
  padding: 1rem 1.25rem;
  border: 0;
  border-radius: 0 0 0.625rem 0.625rem;
  outline: none;
  background: none;
  color: var(--app-heading);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.6;
  resize: vertical;
}
.md.is-compact .md-plain {
  min-height: 140px;
}
.md-slash {
  position: absolute;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-width: 190px;
  padding: 0.375rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  background: var(--app-card);
  box-shadow: var(--app-shadow-float);
}
.md-slash button {
  padding: 0.5rem 0.75rem;
  border: 0;
  border-radius: 0.375rem;
  background: none;
  color: var(--app-heading);
  font: inherit;
  font-size: 0.875rem;
  text-align: start;
  cursor: pointer;
}
.md-slash button:hover,
.md-slash button:focus-visible {
  background: color-mix(in srgb, var(--p-primary-color) 10%, transparent);
  color: var(--p-primary-color);
}
.md-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
</style>
