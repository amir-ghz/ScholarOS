<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Skeleton from 'primevue/skeleton';
import AdminShell from './AdminShell.vue';
import { KIND_LOOK } from './ui/reading/sources';
import ReadingDraftButton from './ReadingDraftButton.vue';
import ReadingVisibility from './ReadingVisibility.vue';
import { api, report } from './api';
import { visible } from './career';
import { formatDate, relativeTime } from './dates';
import { vDialog } from './dialog';
import { AnswerText } from './RoomText';
import { KIND_NAMES, completeAt, linkQuery, matchTitles, outLinks } from './vault';
import type { AdminCtx } from './types';
import type { NoteRow, Suggestion, VaultNote } from '../lib/reading/types';
import type { Visibility } from '../lib/reading/visibility';

// Titles, generated text and suggestions (AI text) are shown with {{ }} or AnswerText only, never as HTML.
const props = defineProps<{ ctx: AdminCtx; id: string }>();
const base = `/${props.ctx.adminPath}`;
const id = Number(props.id);
const href = (n: number) => `${base}/reading/vault/${n}`;
const path = `reading/vault/notes/${id}`;

const note = ref<VaultNote | null>(null);
const generated = ref('');
const backlinks = ref<NoteRow[]>([]);
const suggestions = ref<Suggestion[]>([]);
const titles = ref<NoteRow[]>([]);
const loadError = ref('');
const body = ref('');
let savedBody = ''; // the body as last loaded or saved

// Public or private; every write answers with whether the public copies updated.
const visibility = ref<Visibility | null>(null);
const publishWarning = ref('');
type Written = { note: VaultNote; visibility?: Visibility; publishWarning?: string };
function written(res: Written) {
  note.value = res.note;
  if (res.visibility) visibility.value = res.visibility;
  publishWarning.value = res.publishWarning ?? '';
}
const setPublic = async (on: boolean) => {
  const res = await api<Written & { visibility: Visibility }>(path, { method: 'PATCH', body: { public: on } });
  note.value = res.note;
  return res;
};

async function loadTitles() {
  titles.value = (await api<{ notes: NoteRow[] }>('reading/vault/notes')).notes;
}

// Title: renamed on change, with the body, so its links to itself follow; a refused rename is shown in place and the
// old title comes back. It queues with the body saves, so it never sends a body older than one already saved.
const titleError = ref('');
const titleDraft = ref('');
function rename() {
  const old = note.value!.title;
  const title = titleDraft.value.trim();
  titleError.value = '';
  if (!title || title === old) return void (titleDraft.value = old);
  clearTimeout(saveTimer);
  saving = saving.then(async () => {
    const text = body.value;
    try {
      const res = await api<Written>(path, { method: 'PATCH', body: { title, body: text } });
      written(res);
      savedBody = res.note.body;
      if (body.value === text) body.value = savedBody;
      titleDraft.value = res.note.title;
      titles.value = titles.value.map((t) => (t.id === id ? { ...t, title: res.note.title } : t));
    } catch (err) {
      titleError.value = (err as Error).message;
      titleDraft.value = old;
      void saveBody(); // the body that went with the refused rename, queued after this
    }
  });
}

// Your notes: saved on blur and a second after typing stops, one save at a time.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving = Promise.resolve();
const saveStatus = ref('');
function saveBody() {
  clearTimeout(saveTimer);
  saving = saving.then(async () => {
    const text = body.value;
    if (text === savedBody) return;
    try {
      written(await api<Written>(path, { method: 'PATCH', body: { body: text } }));
      savedBody = text;
      saveStatus.value = 'Saved';
      autoSuggest();
    } catch (e) {
      report(e);
    }
  });
  return saving;
}
/** Leaving the page: the last edit goes with a keepalive request, which outlives the page. */
function flushBody() {
  if (body.value === savedBody) return;
  clearTimeout(saveTimer);
  const text = body.value;
  void fetch(`/api/admin/${path}`, {
    method: 'PATCH',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: text }),
  }).then(
    (res) => res.ok && (savedBody = text),
    () => {}, // unsent: the next save sends it again
  );
}
const onHidden = () => document.visibilityState === 'hidden' && flushBody();

// [[ autocomplete: the textarea is a combobox over the titles matching the open link before the caret.
const textarea = ref<HTMLTextAreaElement | null>(null);
const link = ref<{ start: number; query: string } | null>(null);
const active = ref(0);
const options = computed(() => (link.value ? matchTitles(titles.value, link.value.query, id) : []));
function findLink() {
  const ta = textarea.value!;
  const was = link.value?.query;
  link.value = ta.selectionStart === ta.selectionEnd ? linkQuery(ta.value, ta.selectionStart) : null;
  if (link.value?.query !== was) active.value = 0;
}
function onInput() {
  saveStatus.value = '';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBody, 1000);
  findLink();
}
/** The i-th option, completed at the caret where it is now. */
async function pick(i: number) {
  const ta = textarea.value!;
  const done = completeAt(body.value, ta.selectionStart, titles.value, id, i);
  if (!done) return;
  body.value = done.text;
  link.value = null;
  await nextTick();
  ta.setSelectionRange(done.caret, done.caret);
  onInput();
}
function onKey(e: KeyboardEvent) {
  const n = options.value.length;
  if (!n) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    void nextTick(() => document.getElementById(`adm-vault-opt-${active.value}`)?.scrollIntoView({ block: 'nearest' }));
  } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
    findLink(); // the caret may have moved since the list opened
    if (!options.value.length) return; // no link there now: the key does its usual thing
    e.preventDefault();
    void pick(active.value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    link.value = null;
  }
}
/** A caret moved by keyboard reads the link again (the same link keeps its active option). */
const CARET_KEYS = /^(Arrow(Left|Right|Up|Down)|Home|End|Page(Up|Down))$/;
function onKeyUp(e: KeyboardEvent) {
  if (CARET_KEYS.test(e.key)) findLink();
}
function onBlur() {
  link.value = null;
  void saveBody();
}

/** The body's links, each title once. */
const linksTo = computed(() => {
  const seen = new Set<string>();
  return outLinks(body.value, titles.value).filter(
    (l) => !seen.has(l.title.toLowerCase()) && seen.add(l.title.toLowerCase()),
  );
});

// Suggested links: made once automatically (silently), and again by the button (errors shown).
const suggesting = ref(false);
const suggestStatus = ref('');
const suggestError = ref('');
async function suggest(auto = false) {
  note.value!.suggestedAt = new Date().toISOString(); // the server stamps it too, on every attempt
  suggesting.value = true;
  suggestStatus.value = suggestError.value = '';
  try {
    suggestions.value = (
      await api<{ suggestions: Suggestion[] }>('reading/vault/suggest', { body: { note: id } })
    ).suggestions;
    if (!suggestions.value.length) suggestStatus.value = 'No links to suggest.';
  } catch (e) {
    if (!auto) suggestError.value = (e as Error).message;
  } finally {
    suggesting.value = false;
  }
}
function autoSuggest() {
  const n = note.value!;
  if (!n.suggestedAt && !suggesting.value && (n.kind !== 'free' || savedBody.trim())) void suggest(true);
}
/** Before a draft: this note's latest writing is saved, so the draft reads it. */
const bodySaved = async () => (await saveBody(), body.value === savedBody);
const answering = ref(false);
async function answer(s: Suggestion, accept: boolean) {
  suggestError.value = '';
  if (accept) await saveBody();
  if (accept && body.value !== savedBody) {
    suggestError.value = 'Your latest writing isn’t saved yet, so nothing was linked. Try again once it is saved.';
    return;
  }
  answering.value = true;
  try {
    const res = await api<Written>(`reading/vault/suggestions/${s.id}`, {
      method: 'PATCH',
      body: { accept },
    });
    note.value = res.note;
    if (accept) {
      written(res);
      body.value = savedBody = res.note.body;
      await loadTitles(); // a new concept is a new note
    }
    suggestions.value = suggestions.value.filter((x) => x.id !== s.id);
  } catch (e) {
    report(e);
  } finally {
    answering.value = false;
  }
}

// Delete: a confirm, then back to the list (or, when its public copy is left behind, Publish again here first).
const confirming = ref(false);
const deleting = ref(false);
const deleted = ref(false);
const deleteMore = computed(() => {
  const n = note.value!;
  if (n.kind === 'paper') return ' Its highlights stay in the reading room.';
  if (n.kind !== 'chat') return '';
  if (n.chatId == null) return ' Its chat is gone, so this note is the answer’s only copy.';
  return ` The answer stays in the ${n.chat?.origin === 'notebook' ? 'notebook’s' : 'paper’s'} chat, no longer saved.`;
});
async function remove() {
  deleting.value = true;
  try {
    const res = await api<{ publishWarning?: string } | null>(path, { method: 'DELETE' });
    savedBody = body.value; // nothing left to flush
    if (!res?.publishWarning) return void (location.href = `${base}/reading/vault`);
    publishWarning.value = res.publishWarning;
    visibility.value = null;
    confirming.value = false;
    deleted.value = true;
  } catch (e) {
    report(e);
    deleting.value = false;
  }
}

onMounted(async () => {
  addEventListener('pagehide', flushBody);
  document.addEventListener('visibilitychange', onHidden);
  try {
    const [res] = await Promise.all([
      api<{
        note: VaultNote;
        generated: string;
        backlinks: NoteRow[];
        suggestions: Suggestion[];
        visibility: Visibility;
      }>(path),
      loadTitles(),
    ]);
    note.value = res.note;
    generated.value = res.generated;
    backlinks.value = res.backlinks;
    suggestions.value = res.suggestions;
    visibility.value = res.visibility;
    body.value = savedBody = res.note.body;
    titleDraft.value = res.note.title;
    autoSuggest();
  } catch (e) {
    loadError.value = (e as Error).message;
  }
});
onBeforeUnmount(() => {
  clearTimeout(saveTimer);
  removeEventListener('pagehide', flushBody);
  document.removeEventListener('visibilitychange', onHidden);
});

const NO_SET = new Set<never>();
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/vault" :title="note ? visible(note.title) : 'Note'">
    <p v-if="loadError" class="card rd-load-error" role="alert">
      <i class="pi pi-exclamation-circle" aria-hidden="true" /> {{ loadError }}
    </p>
    <section v-else-if="deleted" class="card rd-deleted">
      <p>
        <i class="pi pi-check-circle" aria-hidden="true" /> Note deleted.
        <a :href="`${base}/reading/vault`">Back to the vault</a>
      </p>
      <ReadingVisibility
        v-model:visibility="visibility"
        v-model:warning="publishWarning"
        :ctx="ctx"
        kind="free"
        :send="setPublic"
      />
    </section>
    <div v-else-if="!note" class="card">
      <Skeleton height="2.5rem" class="mb-3" />
      <Skeleton height="12rem" />
    </div>
    <div v-else class="rd-note">
      <div class="rd-note-main">
        <section class="card rd-note-head">
          <div class="rd-note-top">
            <span :class="['rd-note-icon', `tint-${KIND_LOOK[note.kind].tint}`]" aria-hidden="true"
              ><i :class="['pi', KIND_LOOK[note.kind].icon]"
            /></span>
            <div class="rd-field rd-note-title">
              <label for="adm-vault-note-title">Title</label>
              <InputText
                id="adm-vault-note-title"
                v-model="titleDraft"
                type="text"
                maxlength="200"
                fluid
                :readonly="answering"
                :invalid="!!titleError"
                :aria-invalid="!!titleError || undefined"
                :aria-describedby="titleError ? 'adm-vault-title-error' : undefined"
                @change="rename"
              />
              <span v-if="titleError" id="adm-vault-title-error" class="rd-error" role="alert">{{ titleError }}</span>
            </div>
          </div>
          <p class="rd-note-meta">
            <span :class="['chip', `chip-${KIND_LOOK[note.kind].tint}`]">{{ KIND_NAMES[note.kind] }}</span>
            <span>created {{ formatDate(note.createdAt) }} · updated {{ relativeTime(note.updatedAt) }}</span>
            <a v-if="note.kind === 'paper' && note.paperId" :href="`${base}/reading/papers/${note.paperId}`"
              ><i class="pi pi-book" aria-hidden="true" /> Open in the reading room</a
            >
          </p>
          <div class="rd-note-vis">
            <ReadingVisibility
              v-model:visibility="visibility"
              v-model:warning="publishWarning"
              :ctx="ctx"
              :kind="note.kind === 'paper' ? 'paper' : 'free'"
              :send="setPublic"
            />
          </div>
        </section>

        <section v-if="note.kind !== 'free'" class="card" aria-labelledby="rd-from-room">
          <div class="card-head">
            <h2 id="rd-from-room" class="card-title">
              <i class="pi pi-sparkles text-primary" aria-hidden="true" /> From the reading room
            </h2>
          </div>
          <div class="rd-generated">
            <AnswerText :body="generated" :known="NO_SET" :scans="NO_SET" />
          </div>
        </section>

        <section class="card rd-editor-card">
          <div class="card-head">
            <h2 id="adm-vault-body-label" class="card-title">
              <i class="pi pi-pencil text-primary" aria-hidden="true" /> Your notes
            </h2>
            <span class="rd-save-status" role="status"
              ><template v-if="saveStatus"
                ><i class="pi pi-check" aria-hidden="true" /> {{ saveStatus }}</template
              ></span
            >
          </div>
          <div class="rd-editor">
            <textarea
              ref="textarea"
              v-model="body"
              class="rd-textarea"
              rows="14"
              maxlength="20000"
              role="combobox"
              aria-labelledby="adm-vault-body-label"
              aria-describedby="adm-vault-body-hint"
              aria-autocomplete="list"
              :aria-expanded="options.length > 0"
              aria-controls="adm-vault-options"
              :aria-activedescendant="options.length ? `adm-vault-opt-${active}` : undefined"
              :readonly="answering"
              @input="onInput"
              @click="findLink"
              @keydown="onKey"
              @keyup="onKeyUp"
              @blur="onBlur"
            />
            <ul v-show="options.length" id="adm-vault-options" role="listbox" aria-label="Notes" class="rd-options">
              <li
                v-for="(o, i) in options"
                :id="`adm-vault-opt-${i}`"
                :key="o.id"
                role="option"
                :aria-selected="i === active"
                @mousedown.prevent
                @click="pick(i)"
              >
                <i :class="['pi', KIND_LOOK[o.kind].icon]" aria-hidden="true" />{{ visible(o.title) }}
              </li>
            </ul>
          </div>
          <small id="adm-vault-body-hint" class="rd-hint"
            ><i class="pi pi-link" aria-hidden="true" /> Type [[ to link a note.</small
          >
        </section>
      </div>

      <div class="rd-note-side">
        <section v-if="linksTo.length" class="card" aria-labelledby="rd-links-to">
          <h2 id="rd-links-to" class="card-title rd-side-title">
            <span class="rd-side-icon tint-primary" aria-hidden="true"><i class="pi pi-arrow-up-right" /></span> Links
            to
          </h2>
          <ul class="rd-links">
            <li v-for="l in linksTo" :key="l.title.toLowerCase()">
              <a v-if="l.id !== null" :href="href(l.id)" dir="auto">{{ visible(l.title) }}</a>
              <span v-else dir="auto">{{ visible(l.title) }} <span class="chip chip-warning">(no note yet)</span></span>
            </li>
          </ul>
        </section>

        <section class="card" aria-labelledby="rd-backlinks">
          <h2 id="rd-backlinks" class="card-title rd-side-title">
            <span class="rd-side-icon tint-info" aria-hidden="true"><i class="pi pi-arrow-left" /></span> Backlinks
          </h2>
          <ul v-if="backlinks.length" class="rd-links">
            <li v-for="b in backlinks" :key="b.id">
              <a :href="href(b.id)" dir="auto">{{ visible(b.title) }}</a>
              <span class="rd-link-sub">{{ KIND_NAMES[b.kind] }} · updated {{ relativeTime(b.updatedAt) }}</span>
            </li>
          </ul>
          <p v-else class="rd-muted">No notes link here yet.</p>
        </section>

        <section class="card" aria-labelledby="rd-suggested">
          <h2 id="rd-suggested" class="card-title rd-side-title">
            <span class="rd-side-icon tint-pink" aria-hidden="true"><i class="pi pi-sparkles" /></span> Suggested links
          </h2>
          <ul v-if="suggestions.length" class="rd-links rd-suggestions">
            <li v-for="s in suggestions" :key="s.id">
              <span>
                <a v-if="s.targetId !== null" :href="href(s.targetId)" dir="auto">{{ visible(s.title) }}</a>
                <template v-else
                  ><span class="rd-new-concept" dir="auto">{{ visible(s.title) }}</span>
                  <span class="chip chip-success">New note</span></template
                >
              </span>
              <span class="rd-link-sub">{{ visible(s.reason) }}</span>
              <span class="rd-suggestion-actions">
                <Button
                  size="small"
                  icon="pi pi-link"
                  label="Link"
                  :disabled="answering"
                  :aria-label="`Link “${visible(s.title)}”`"
                  @click="answer(s, true)"
                />
                <Button
                  size="small"
                  severity="secondary"
                  text
                  icon="pi pi-times"
                  label="Dismiss"
                  :disabled="answering"
                  :aria-label="`Dismiss “${visible(s.title)}”`"
                  @click="answer(s, false)"
                />
              </span>
            </li>
          </ul>
          <div class="rd-side-actions">
            <Button
              severity="secondary"
              outlined
              icon="pi pi-sparkles"
              :label="suggesting ? 'Suggesting…' : 'Suggest links'"
              :disabled="suggesting"
              @click="suggest()"
            />
            <ReadingDraftButton
              :ctx="ctx"
              :from="{ note: id }"
              :before="bodySaved"
              hint="Writes an unpublished draft in your voice from this note and the papers it is about or links, and opens it in the blog editor. One reading-room AI call."
            />
          </div>
          <p class="rd-muted" role="status">{{ suggestStatus }}</p>
          <p v-if="suggestError" class="rd-error" role="alert">{{ suggestError }}</p>
        </section>

        <section class="card rd-danger">
          <Button severity="danger" outlined icon="pi pi-trash" label="Delete note" @click="confirming = true" />
        </section>
      </div>

      <div
        v-if="confirming"
        v-dialog
        class="rd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adm-vault-delete"
        @keydown.esc="confirming = false"
      >
        <div class="rd-modal-box">
          <span class="stat-icon tint-danger" aria-hidden="true"><i class="pi pi-trash" /></span>
          <h2 id="adm-vault-delete" class="rd-modal-title">Delete “{{ visible(note.title) }}”?</h2>
          <p>Links to it in other notes stay, unresolved.{{ deleteMore }}</p>
          <div class="rd-modal-actions">
            <Button label="Cancel" severity="secondary" outlined data-autofocus @click="confirming = false" />
            <Button label="Delete note" severity="danger" :disabled="deleting" @click="remove" />
          </div>
        </div>
      </div>
    </div>
  </AdminShell>
</template>

<style scoped>
.rd-load-error {
  color: var(--c-danger);
}
.rd-muted {
  margin: 0;
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-error {
  margin: 0;
  color: var(--c-danger);
  font-size: 0.8125rem;
}
.rd-deleted {
  display: grid;
  gap: 1rem;
}
.rd-deleted > p {
  margin: 0;
  color: var(--app-heading);
}
.rd-deleted .pi {
  color: var(--c-success);
}

/* Two columns: the note (title, generated text, editor), then its links and actions in side cards. */
.rd-note {
  display: grid;
  gap: 1rem;
  align-items: start;
}
@media (min-width: 1200px) {
  .rd-note {
    grid-template-columns: minmax(0, 1fr) 360px;
  }
}
.rd-note-main,
.rd-note-side {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.rd-note-head {
  display: grid;
  gap: 1rem;
}
.rd-note-top {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
}
.rd-note-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.625rem;
  font-size: 1.125rem;
}
.rd-field {
  display: grid;
  gap: 0.375rem;
}
.rd-field > label {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.rd-note-title {
  flex: 1;
  min-width: 0;
}
.rd-note-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem 0.75rem;
  margin: 0;
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-note-meta a {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2rem;
  font-weight: 500;
}
.rd-note-vis {
  display: grid;
  gap: 0.5rem;
  padding-block-start: 1rem;
  border-top: 1px dashed var(--app-border);
}
.rd-generated :deep(.adm-answer) {
  color: var(--app-body);
  font-size: 0.9375rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.rd-generated :deep(.adm-answer h4) {
  margin: 1em 0 0.375em;
  color: var(--app-heading);
  font-size: 0.9375rem;
}
.rd-generated :deep(.adm-answer > :first-child) {
  margin-block-start: 0;
}
.rd-generated :deep(.adm-answer :is(ul, ol)) {
  padding-inline-start: 1.25em;
  list-style: disc;
}
.rd-save-status {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--c-success);
  font-size: 0.8125rem;
  font-weight: 500;
}
.rd-editor {
  position: relative;
}
.rd-textarea {
  display: block;
  width: 100%;
  min-height: 18rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--p-inputtext-border-color, var(--app-border));
  border-radius: var(--p-inputtext-border-radius, 0.5rem);
  background: var(--p-inputtext-background, var(--app-card));
  color: var(--app-heading);
  font: inherit;
  font-size: 0.9375rem;
  line-height: 1.65;
  resize: vertical;
}
.rd-textarea:hover {
  border-color: var(--p-inputtext-hover-border-color, var(--app-muted));
}
.rd-textarea:focus {
  outline: 0;
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}
.rd-options {
  position: absolute;
  inset-inline: 0.5rem;
  inset-block-start: calc(100% + 0.25rem);
  z-index: 10;
  max-height: 16rem;
  margin: 0;
  padding: 0.375rem;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  background: var(--app-card);
  box-shadow: var(--app-shadow-float);
}
.rd-options li {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-height: 2.5rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.5rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  cursor: pointer;
}
.rd-options li .pi {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-options li[aria-selected='true'] {
  background: color-mix(in srgb, var(--p-primary-color) 10%, transparent);
  color: var(--p-primary-color);
}
.rd-options li[aria-selected='true'] .pi {
  color: inherit;
}
.rd-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin-block-start: 0.625rem;
  color: var(--app-muted);
  font-size: 0.8125rem;
}

/* Side cards. */
.rd-side-title {
  margin-block-end: 0.75rem;
  font-size: 1rem;
}
.rd-side-icon {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  font-size: 0.8125rem;
}
.rd-links {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rd-links > li {
  display: grid;
  gap: 0.125rem;
  padding-block: 0.625rem;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.rd-links > li + li {
  border-top: 1px dashed var(--app-border);
}
.rd-links a {
  color: var(--app-heading);
  font-weight: 600;
  text-decoration: none;
}
.rd-links a:hover {
  color: var(--p-primary-color);
}
.rd-link-sub {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-new-concept {
  margin-inline-end: 0.375rem;
  color: var(--app-heading);
  font-weight: 600;
}
.rd-suggestion-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-block-start: 0.375rem;
}
.rd-side-actions {
  display: grid;
  justify-items: start;
  gap: 0.75rem;
  margin-block-start: 0.75rem;
  padding-block-start: 0.875rem;
  border-top: 1px solid var(--app-border);
}
.rd-side-actions + .rd-muted,
.rd-side-actions ~ .rd-error {
  margin-block-start: 0.5rem;
}
.rd-danger {
  padding-block: 1rem;
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
  .rd-note-icon {
    display: none;
  }
}
</style>
