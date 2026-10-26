<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import ProgressBar from 'primevue/progressbar';
import Skeleton from 'primevue/skeleton';
import Textarea from 'primevue/textarea';
import AdminShell from './AdminShell.vue';
import { sourceTint } from './ui/reading/sources';
import ReadingDraftButton from './ReadingDraftButton.vue';
import ReadingVisibility from './ReadingVisibility.vue';
import { ApiError, api, report, toast } from './api';
import { visible } from './career';
import { formatDate } from './dates';
import { SOURCE_NAMES, authorsLine } from './reading';
import { progressLine, selectionInPassage, textLabel } from './reading-room';
import { AnswerText, ClaimList, PaperText } from './RoomText';
import type { AdminCtx } from './types';
import type { ChatMessage, Cite, Highlight, Output, OutputKind, Paper, Passage, TextState } from '../lib/reading/types';
import type { Visibility } from '../lib/reading/visibility';

// Paper text, titles and AI output are third-party: shown with {{ }} or through RoomText's text-node renderers only.
const props = defineProps<{ ctx: AdminCtx; paper?: string; notebook?: string }>();
const base = `/${props.ctx.adminPath}`;
const target = props.notebook ? { notebook: Number(props.notebook) } : { paper: Number(props.paper) };
const isNb = 'notebook' in target;
const MAX_PDF = 4 * 1024 * 1024;
const AIDS: [OutputKind, string][] = [
  ['briefing', 'Briefing'],
  ['faq', 'FAQ'],
  ['glossary', 'Glossary'],
];

interface Use {
  today: number;
  cap: number;
}
interface Room {
  title: string;
  papers: Paper[];
  texts: Record<number, TextState>;
  passages: Record<number, Passage[]>;
  outputs: Partial<Record<OutputKind, Output>>;
  highlights: Highlight[];
  use: Use;
  /** the notebooks a paper is in (a paper's room only) */
  inNotebooks: { id: number; title: string }[];
  /** the room's note in the vault, once there is one */
  vaultNote: number | null;
  /** the room's note on the public site */
  visibility: Visibility;
}
type PaperRes = Omit<Room, 'title' | 'papers' | 'texts' | 'passages' | 'inNotebooks'> & {
  paper: Paper;
  text: TextState;
  passages: Passage[];
  notebooks: Room['inNotebooks'];
  note: string;
};
type NotebookRes = Omit<Room, 'title' | 'inNotebooks'> & {
  notebook: { id: number; title: string };
  note: string;
};

const room = ref<Room | null>(null);
const loadError = ref('');
const shown = ref(0); // the paper in the paper pane
const note = ref('');
let savedNote = ''; // the note as last loaded or saved
let timer: ReturnType<typeof setInterval> | undefined;

async function load(first = false) {
  const open = first ? '?open=1' : ''; // opening fetches a text never fetched or failed; a poll doesn't
  try {
    let r: Room;
    let n: string;
    if (isNb) {
      const res = await api<NotebookRes>(`reading/notebooks/${target.notebook}${open}`);
      r = { ...res, title: res.notebook.title, inNotebooks: [] };
      n = res.note;
    } else {
      const res = await api<PaperRes>(`reading/papers/${target.paper}${open}`);
      r = {
        ...res,
        title: res.paper.title,
        papers: [res.paper],
        texts: { [res.paper.id]: res.text },
        passages: { [res.paper.id]: res.passages },
        inNotebooks: res.notebooks,
      };
      n = res.note;
    }
    room.value = r;
    if (first) note.value = savedNote = n;
    if (!r.papers.some((p) => p.id === shown.value)) shown.value = r.papers[0]?.id ?? 0;
  } catch (e) {
    stop();
    if (first) loadError.value = e instanceof Error ? e.message : String(e);
    else report(e);
    return;
  }
  // Poll while something is on its way: a run writing an output, or a text being fetched for the first time (for
  // PENDING_POLLS at most: a text-only run that died leaves it never fetched). A text with an error isn't polled: only
  // reopening fetches it again.
  const running = Object.values(room.value!.outputs).some((o) => o.status === 'running');
  const waiting = room.value!.papers.some(pending) && pendingPolls++ < PENDING_POLLS;
  if (running || waiting) timer ??= setInterval(load, 3000);
  else stop();
}
const PENDING_POLLS = 100; // 5 minutes: a notebook's texts wait 15 s apart on arXiv
let pendingPolls = 0;
function stop() {
  clearInterval(timer);
  timer = undefined;
}
const pending = (p: Paper) => {
  const t = room.value!.texts[p.id];
  return !!p.arxiv && !t.source && !t.error;
};

const cur = computed(() => room.value?.papers.find((p) => p.id === shown.value) ?? null);
const text = computed(() => (cur.value ? room.value!.texts[cur.value.id] : null));
const label = computed(() => text.value && textLabel(text.value));
const canUpload = computed(
  () => !!text.value && (text.value.source === 'abstract' || text.value.source === 'scan' || !!text.value.error),
);
const known = computed(
  () => new Set(Object.entries(room.value?.passages ?? {}).flatMap(([id, ps]) => ps.map((p) => `${id}:${p.pid}`))),
);
const scans = computed(
  () => new Set((room.value?.papers ?? []).filter((p) => room.value!.texts[p.id].source === 'scan').map((p) => p.id)),
);
const citeNames = computed(() => (isNb ? new Map(room.value?.papers.map((p) => [p.id, p])) : undefined));
const textReady = computed(
  () => !!room.value?.papers.every((p) => room.value!.texts[p.id].source && !room.value!.texts[p.id].error),
);
const meta = (p: Paper) =>
  [authorsLine(p.authors), SOURCE_NAMES[p.source] ?? p.source, p.publishedAt && formatDate(p.publishedAt)]
    .filter(Boolean)
    .join(' · ');

// Tabs: Summary · Chat · Notes beside the paper from 1024px; below that the paper is a tab too.
const wideQuery = matchMedia('(min-width: 1024px)');
const wide = ref(wideQuery.matches);
const onWide = () => (wide.value = wideQuery.matches);
const tab = ref(wide.value ? 'summary' : 'paper');
const tabs = computed(() => [
  ...(wide.value ? [] : [['paper', 'Paper']]),
  ['summary', 'Summary'],
  ['chat', 'Chat'],
  ['notes', 'Notes'],
]);
watch(wide, (w) => {
  if (w && tab.value === 'paper') tab.value = 'summary';
});
function onTabKey(e: KeyboardEvent) {
  const rtl = getComputedStyle(e.currentTarget as Element).direction === 'rtl';
  const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
  const ids = tabs.value.map(([id]) => id);
  const n = ids.length;
  const at = ids.indexOf(tab.value);
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : step ? (at + step + n) % n : -1;
  if (to < 0) return;
  e.preventDefault();
  tab.value = ids[to];
  void nextTick(() => document.getElementById(`room-tab-${ids[to]}`)?.focus());
}
/** One tab row, rendered above the paper in one column and above the side pane in two. */
const TabList = () =>
  h(
    'div',
    { class: 'rd-tabs', role: 'tablist', 'aria-label': 'Reading room', onKeydown: onTabKey },
    tabs.value.map(([id, name]) =>
      h(
        'button',
        {
          id: `room-tab-${id}`,
          type: 'button',
          role: 'tab',
          'aria-selected': tab.value === id ? 'true' : 'false',
          'aria-controls': `room-panel-${id}`,
          tabindex: tab.value === id ? 0 : -1,
          onClick: () => (tab.value = id),
        },
        name,
      ),
    ),
  );

// Citations: the paper shows the passage (switching tab and paper first), scrolls it to the middle, focuses and flashes it.
const flash = ref<Cite | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | undefined;
async function jump(c: Cite) {
  if (!wide.value) tab.value = 'paper';
  shown.value = c.paper;
  await nextTick();
  const el = document.getElementById(`psg-${c.paper}-${c.pid}`);
  if (!el) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
  flash.value = c;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flash.value = null), 2000);
}

// Public or private: in a paper's room the toggle gives the paper its note when it has none; a notebook's room has
// the toggle once its note exists. Writes answer with whether the public copies updated.
const publishWarning = ref('');
const warned = (res: { publishWarning?: string } | null) => (publishWarning.value = res?.publishWarning ?? '');
const shared = computed(() => ({
  on: room.value?.highlights.filter((x) => x.public).length ?? 0,
  all: room.value?.highlights.length ?? 0,
}));
async function setPublic(on: boolean) {
  const res = await api<{ visibility: Visibility; publishWarning?: string }>('reading/vault/publish', {
    body: { paper: target.paper, public: on },
  });
  room.value!.vaultNote ??= res.visibility.noteId;
  return res;
}
const setNotebookPublic = (on: boolean) =>
  api<{ visibility: Visibility; publishWarning?: string }>(`reading/vault/notes/${room.value!.vaultNote}`, {
    method: 'PATCH',
    body: { public: on },
  });
const publicLabel = (hl: Highlight) => {
  const q = visible(hl.quote);
  return `Public: “${q.length > 40 ? `${q.slice(0, 40)}…` : q}”`;
};
/** A highlight's Public box: ticked at once, unticked again (with the route's sentence beside it) when refused. */
const hlError = ref<{ id: number; text: string } | null>(null);
async function setHighlightPublic(hl: Highlight, on: boolean) {
  hl.public = on;
  hlError.value = null;
  try {
    warned(await api(`reading/highlights/${hl.id}`, { method: 'PATCH', body: { public: on } }));
  } catch (e) {
    hl.public = !on;
    hlError.value = { id: hl.id, text: (e as Error).message };
  }
}

/** After a save, highlight or note: reload so the link to the new vault note appears. */
function toVault() {
  if (!room.value?.vaultNote) void load();
}

// Header actions.
async function toggleSave() {
  const p = cur.value!;
  try {
    p.state = (
      await api<{ state: Paper['state'] }>(`reading/papers/${p.id}`, {
        method: 'PATCH',
        body: { state: p.state === 'saved' ? 'new' : 'saved' },
      })
    ).state;
    toVault();
  } catch (e) {
    report(e);
  }
}
const notebooks = ref<{ id: number; title: string }[]>([]);
const addable = computed(() => notebooks.value.filter((n) => !room.value?.inNotebooks.some((m) => m.id === n.id)));
async function addToNotebook(e: Event) {
  const select = e.target as HTMLSelectElement;
  const choice = select.value;
  select.value = '';
  if (!choice) return;
  try {
    let id = Number(choice);
    let title = notebooks.value.find((n) => n.id === id)?.title;
    if (choice === 'new') {
      title = window.prompt('Notebook title')?.trim();
      if (!title) return;
      id = (await api<{ id: number }>('reading/notebooks', { body: { title } })).id;
    }
    await api(`reading/notebooks/${id}`, { method: 'PATCH', body: { add: target.paper } });
    toast(`Added to ${title}`);
    await Promise.all([load(), loadNotebooks()]);
  } catch (err) {
    report(err);
  }
}
async function loadNotebooks() {
  notebooks.value = (await api<{ notebooks: { id: number; title: string }[] }>('reading/notebooks')).notebooks;
}
async function patchNotebook(body: object) {
  try {
    await api(`reading/notebooks/${target.notebook}`, { method: 'PATCH', body });
    await load();
    return true;
  } catch (e) {
    report(e);
    return false;
  }
}
async function rename(e: Event) {
  const title = (e.target as HTMLInputElement).value.trim();
  if (title && title !== room.value!.title) await patchNotebook({ title });
}
const newRef = ref('');
const adding = ref(false);
async function addPaper() {
  if (!newRef.value.trim()) return;
  adding.value = true;
  pendingPolls = 0; // the added paper's text is fetched next
  if (await patchNotebook({ add: newRef.value.trim() })) newRef.value = '';
  adding.value = false;
}

// The paper pane: an upload for a paper without its full text, highlights on a selection.
const uploadError = ref('');
const uploading = ref(false);
watch(shown, () => (uploadError.value = ''));
async function upload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  uploadError.value = '';
  if (!file) return;
  if (file.size > MAX_PDF) return void (uploadError.value = 'PDFs up to 4 MB can be uploaded');
  uploading.value = true;
  try {
    await api(`reading/papers/${shown.value}/pdf`, { form: file });
    summaryAsked = false; // the upload cleared the summary written from the old text: write it again
    await load();
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    uploading.value = false;
  }
}

const pane = ref<HTMLElement | null>(null);
type Sel = NonNullable<ReturnType<typeof selectionInPassage>>;
/** The popup at a selection (Highlight, Comment) or at a clicked mark (its comment, Delete), placed in the pane. */
const tool = ref<
  | { at: { x: number; y: number }; kind: 'across' }
  | { at: { x: number; y: number }; kind: 'new'; pick: Sel; commenting: boolean; comment: string }
  | { at: { x: number; y: number }; kind: 'mark'; hl: Highlight; comment: string }
  | null
>(null);
function placeAt(rect: DOMRect) {
  const box = pane.value!.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.left - box.left, box.width - 280)),
    y: rect.bottom - box.top + pane.value!.scrollTop + 6,
  };
}
function onSelect(e: Event) {
  if ((e.target as Element).closest?.('.adm-room-tool')) return;
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !pane.value?.contains(sel.anchorNode)) {
    if (tool.value?.kind !== 'mark') tool.value = null;
    return;
  }
  const at = placeAt(sel.getRangeAt(0).getBoundingClientRect());
  const pick = selectionInPassage(sel);
  tool.value = pick ? { at, kind: 'new', pick, commenting: false, comment: '' } : { at, kind: 'across' };
}
function onPaneClick(e: MouseEvent) {
  const mark = (e.target as Element).closest?.('mark[data-hl]');
  if (!mark || !getSelection()?.isCollapsed) return;
  openMark(mark, Number(mark.getAttribute('data-hl')!.split(' ')[0]));
}
function openMark(mark: Element, id: number) {
  const hl = room.value!.highlights.find((x) => x.id === id);
  if (hl) tool.value = { at: placeAt(mark.getBoundingClientRect()), kind: 'mark', hl, comment: hl.comment };
}
async function focusTool() {
  await nextTick();
  pane.value?.querySelector<HTMLElement>('.adm-room-tool textarea, .adm-room-tool button')?.focus();
}
async function saveHighlight() {
  const t = tool.value;
  if (t?.kind !== 'new') return;
  try {
    const { highlight } = await api<{ highlight: Highlight }>('reading/highlights', {
      body: { paper: shown.value, ...t.pick, comment: t.comment.trim() },
    });
    room.value!.highlights.push(highlight);
    getSelection()?.removeAllRanges();
    tool.value = null;
    toVault();
  } catch (e) {
    report(e);
  }
}
async function saveComment() {
  const t = tool.value;
  if (t?.kind !== 'mark') return;
  try {
    warned(await api(`reading/highlights/${t.hl.id}`, { method: 'PATCH', body: { comment: t.comment.trim() } }));
    const hl = room.value!.highlights.find((x) => x.id === t.hl.id); // a poll may have replaced t.hl
    if (hl) hl.comment = t.comment.trim();
    tool.value = null;
  } catch (e) {
    report(e);
  }
}
async function deleteHighlight() {
  const t = tool.value;
  if (t?.kind !== 'mark') return;
  try {
    warned(await api(`reading/highlights/${t.hl.id}`, { method: 'DELETE' }));
    room.value!.highlights = room.value!.highlights.filter((x) => x.id !== t.hl.id);
    tool.value = null;
  } catch (e) {
    report(e);
  }
}
/** From the Notes tab: go to the highlight's passage and open its comment there. */
async function showHighlight(hl: Highlight) {
  await jump({ paper: hl.paperId, pid: hl.pid });
  const mark = pane.value?.querySelector(`mark[data-hl~="${hl.id}"]`);
  if (mark) {
    openMark(mark, hl.id);
    await focusTool();
  }
}

// Summary and study aids: written by a background run; the room is polled while one runs.
let summaryAsked = false;
async function generate(kind: OutputKind) {
  try {
    await api('reading/outputs', { body: { ...target, kind } });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) return report(e); // 409: already running, so just poll
  }
  await load();
}
const outdated = (o: Output) =>
  isNb &&
  !!o.body &&
  [...o.body.papers].sort().join() !==
    room
      .value!.papers.map((p) => p.id)
      .sort()
      .join();
watch([tab, room], () => {
  if (tab.value !== 'summary' || !room.value || summaryAsked || room.value.outputs.summary) return;
  if (isNb && !room.value.papers.length) return;
  summaryAsked = true;
  void generate('summary');
});

// Chat.
const messages = ref<ChatMessage[]>([]);
const question = ref('');
const asking = ref(false);
const chatError = ref('');
const chatQuery = isNb ? `notebook=${target.notebook}` : `paper=${target.paper}`;
async function ask() {
  const q = question.value.trim();
  if (!q || asking.value) return;
  asking.value = true;
  chatError.value = '';
  try {
    const r = await api<{ question: ChatMessage; answer: ChatMessage }>('reading/chat', {
      body: { ...target, question: q },
    });
    messages.value.push(r.question, r.answer);
    question.value = '';
  } catch (e) {
    chatError.value = e instanceof Error ? e.message : String(e);
  } finally {
    asking.value = false;
    void load(); // today's AI use
    await nextTick();
    document.getElementById('room-question')?.focus();
  }
}
function onAskKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  void ask();
}
async function toggleSaved(m: ChatMessage) {
  try {
    m.saved = (
      await api<{ saved: boolean }>(`reading/chat/${m.id}`, { method: 'PATCH', body: { saved: !m.saved } })
    ).saved;
    toVault();
  } catch (e) {
    report(e);
  }
}

// Notes: saved on blur and a second after typing stops, one save at a time.
let noteTimer: ReturnType<typeof setTimeout> | undefined;
let noteSaving = Promise.resolve();
const noteStatus = ref('');
function onNoteInput() {
  noteStatus.value = '';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(saveNote, 1000);
}
function saveNote() {
  clearTimeout(noteTimer);
  noteSaving = noteSaving.then(async () => {
    const body = note.value;
    if (body === savedNote) return;
    try {
      warned(await api('reading/notes', { method: 'PUT', body: { ...target, body } }));
      savedNote = body;
      noteStatus.value = 'Saved';
      toVault();
    } catch (e) {
      report(e);
    }
  });
  return noteSaving;
}
/** Before a draft: the room's latest note is saved, so the draft reads it. */
const noteSaved = async () => (await saveNote(), note.value === savedNote);
/** Leaving the page: the last edit goes with a keepalive request, which outlives the page. */
function flushNote() {
  if (note.value === savedNote) return;
  clearTimeout(noteTimer);
  void fetch('/api/admin/reading/notes', {
    method: 'PUT',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...target, body: note.value }),
  });
  savedNote = note.value;
}
const onHidden = () => document.visibilityState === 'hidden' && flushNote();
const paperTitle = (id: number) => visible(room.value?.papers.find((p) => p.id === id)?.title ?? '');

onMounted(async () => {
  wideQuery.addEventListener('change', onWide);
  addEventListener('pagehide', flushNote);
  document.addEventListener('visibilitychange', onHidden);
  await load(true);
  const [c, n] = await Promise.allSettled([
    api<{ messages: ChatMessage[] }>(`reading/chat?${chatQuery}`),
    isNb ? Promise.resolve() : loadNotebooks(),
  ]);
  if (c.status === 'fulfilled') messages.value = c.value.messages;
  else if (!loadError.value) report(c.reason);
  if (n.status === 'rejected' && !loadError.value) report(n.reason);
});
onBeforeUnmount(() => {
  stop();
  clearTimeout(flashTimer);
  wideQuery.removeEventListener('change', onWide);
  removeEventListener('pagehide', flushNote);
  document.removeEventListener('visibilitychange', onHidden);
});
</script>

<template>
  <AdminShell
    :ctx="ctx"
    :active="isNb ? 'reading/notebooks' : 'reading'"
    :title="room ? visible(room.title) : isNb ? 'Notebook' : 'Paper'"
  >
    <p v-if="loadError" class="card rd-load-error" role="alert">
      <i class="pi pi-exclamation-circle" aria-hidden="true" /> {{ loadError }}
    </p>
    <div v-else-if="!room" class="card">
      <p class="adm-visually-hidden">Loading…</p>
      <Skeleton height="1.25rem" width="40%" class="mb-3" />
      <Skeleton height="2.5rem" width="70%" />
    </div>
    <template v-else>
      <section class="card rd-head">
        <template v-if="!isNb && cur">
          <div class="rd-head-top">
            <span :class="['rd-head-icon', `tint-${sourceTint(cur.source)}`]" aria-hidden="true"
              ><i class="pi pi-file"
            /></span>
            <div class="rd-head-text">
              <p class="rd-meta">
                <span :class="['chip', `chip-${sourceTint(cur.source)}`]">{{
                  SOURCE_NAMES[cur.source] ?? cur.source
                }}</span>
                <span v-if="cur.authors.length" dir="auto">{{ authorsLine(cur.authors) }}</span>
                <template v-if="cur.publishedAt">
                  <span aria-hidden="true">·</span
                  ><time :datetime="cur.publishedAt">{{ formatDate(cur.publishedAt) }}</time>
                </template>
              </p>
              <p v-if="room.inNotebooks.length" class="rd-in">
                <i class="pi pi-book" aria-hidden="true" /> In
                <span v-for="(n, i) in room.inNotebooks" :key="n.id"
                  >{{ i ? ', ' : '' }}<a :href="`${base}/reading/notebooks/${n.id}`">{{ visible(n.title) }}</a></span
                >
              </p>
            </div>
          </div>
          <div class="rd-head-actions">
            <Button
              as="a"
              :href="cur.url"
              target="_blank"
              rel="noopener noreferrer"
              label="Source"
              icon="pi pi-external-link"
              severity="secondary"
              outlined
            />
            <Button
              :icon="cur.state === 'saved' ? 'pi pi-bookmark-fill' : 'pi pi-bookmark'"
              :label="cur.state === 'saved' ? 'Saved' : 'Save'"
              :severity="cur.state === 'saved' ? undefined : 'secondary'"
              :outlined="cur.state !== 'saved'"
              :aria-pressed="cur.state === 'saved'"
              @click="toggleSave"
            />
            <span class="rd-select-wrap">
              <select aria-label="Add to notebook" class="rd-select" @change="addToNotebook">
                <option value="">Add to notebook…</option>
                <option v-for="n in addable" :key="n.id" :value="n.id">{{ n.title }}</option>
                <option value="new">New notebook…</option>
              </select>
              <i class="pi pi-chevron-down" aria-hidden="true" />
            </span>
            <ReadingDraftButton
              :ctx="ctx"
              :from="{ paper: cur.id }"
              :before="noteSaved"
              hint="Writes an unpublished draft in your voice from this paper, your notes and saved answers, and opens it in the blog editor. One reading-room AI call."
            />
          </div>
          <div class="rd-head-vis">
            <ReadingVisibility
              v-model:visibility="room.visibility"
              v-model:warning="publishWarning"
              :ctx="ctx"
              kind="paper"
              :shared="shared"
              :send="setPublic"
            />
          </div>
        </template>
        <template v-else-if="isNb">
          <div class="rd-head-vis rd-head-vis-first">
            <ReadingVisibility
              v-model:visibility="room.visibility"
              v-model:warning="publishWarning"
              :ctx="ctx"
              kind="free"
              :send="setNotebookPublic"
            />
          </div>
          <div class="rd-field rd-nb-title">
            <label for="room-nb-title">Title</label>
            <InputText id="room-nb-title" :model-value="room.title" maxlength="200" @change="rename" />
          </div>
          <ul v-if="room.papers.length" class="rd-nb-papers">
            <li v-for="p in room.papers" :key="p.id">
              <span :class="['rd-nb-thumb', `tint-${sourceTint(p.source)}`]" aria-hidden="true"
                ><i class="pi pi-file"
              /></span>
              <span class="rd-nb-paper">
                <a :href="`${base}/reading/papers/${p.id}`" dir="auto">{{ visible(p.title) }}</a>
                <span class="rd-nb-sub">{{ meta(p) }}</span>
              </span>
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-times"
                label="Remove"
                :aria-label="`Remove ${visible(p.title)}`"
                @click="patchNotebook({ remove: p.id })"
              />
            </li>
          </ul>
          <form class="rd-nb-add" @submit.prevent="addPaper">
            <label class="adm-visually-hidden" for="room-add-ref">arXiv id or DOI</label>
            <InputText id="room-add-ref" v-model="newRef" type="text" placeholder="arXiv id or DOI" maxlength="300" />
            <Button
              type="submit"
              icon="pi pi-plus"
              severity="secondary"
              outlined
              :label="adding ? 'Adding…' : 'Add a paper'"
              :disabled="adding"
            />
          </form>
          <ReadingDraftButton
            :ctx="ctx"
            :from="target"
            :before="noteSaved"
            hint="Writes an unpublished draft in your voice from this notebook’s papers (a roundup when it has several), its note and your saved answers, and opens it in the blog editor. One reading-room AI call."
          />
        </template>
      </section>

      <div class="rd-room">
        <TabList v-if="!wide" />
        <section
          v-if="wide || tab === 'paper'"
          ref="pane"
          class="card rd-paper"
          v-bind="
            wide
              ? { 'aria-label': 'Paper' }
              : { id: 'room-panel-paper', role: 'tabpanel', 'aria-labelledby': 'room-tab-paper' }
          "
          @mouseup="onSelect"
          @keyup="onSelect"
          @click="onPaneClick"
          @keydown.esc="tool = null"
        >
          <h2 class="adm-visually-hidden">Paper</h2>
          <div v-if="!room.papers.length" class="empty-state">
            <i class="pi pi-file" aria-hidden="true" />
            <p>Add a paper to this notebook to read it here.</p>
          </div>
          <template v-if="cur && text">
            <div v-if="isNb" class="rd-field">
              <label for="room-paper-pick">Paper</label>
              <span class="rd-select-wrap rd-select-full">
                <select id="room-paper-pick" v-model="shown" class="rd-select">
                  <option v-for="p in room.papers" :key="p.id" :value="p.id">{{ visible(p.title) }}</option>
                </select>
                <i class="pi pi-chevron-down" aria-hidden="true" />
              </span>
            </div>
            <div v-if="label || canUpload" class="rd-text-label">
              <i class="pi pi-info-circle" aria-hidden="true" />
              <p v-if="label">{{ label }}</p>
              <label
                v-if="canUpload"
                class="p-button p-component p-button-secondary p-button-outlined p-button-sm rd-upload"
              >
                <i class="pi pi-upload p-button-icon p-button-icon-left" aria-hidden="true" />
                <span class="p-button-label">{{ uploading ? 'Uploading…' : 'Upload the PDF' }}</span>
                <input type="file" accept="application/pdf" :disabled="uploading" @change="upload" />
              </label>
              <p v-if="uploadError" class="rd-error" role="alert">{{ uploadError }}</p>
            </div>
            <PaperText
              v-if="room.passages[cur.id].length"
              :paper-id="cur.id"
              :passages="room.passages[cur.id]"
              :highlights="room.highlights.filter((x) => x.paperId === cur!.id)"
              :arxiv="text.source === 'arxiv-html' ? cur.arxiv : null"
              :flash="flash?.paper === cur.id ? flash.pid : null"
            />
            <p v-else-if="cur.abstract" class="adm-paper-text">{{ visible(cur.abstract) }}</p>
          </template>
          <div
            v-if="tool"
            class="adm-room-tool"
            :style="{ insetInlineStart: `${tool.at.x}px`, insetBlockStart: `${tool.at.y}px` }"
          >
            <p v-if="tool.kind === 'across'" role="status">Select within one paragraph to highlight.</p>
            <template v-else-if="tool.kind === 'new'">
              <template v-if="tool.commenting">
                <label class="adm-visually-hidden" for="room-hl-comment">Comment</label>
                <Textarea id="room-hl-comment" v-model="tool.comment" rows="3" maxlength="2000" />
                <Button size="small" label="Save" @click="saveHighlight" />
              </template>
              <template v-else>
                <Button size="small" icon="pi pi-pencil" label="Highlight" @click="saveHighlight" />
                <Button
                  size="small"
                  severity="secondary"
                  outlined
                  icon="pi pi-comment"
                  label="Comment"
                  @click="((tool.commenting = true), focusTool())"
                />
              </template>
            </template>
            <template v-else>
              <label class="adm-visually-hidden" for="room-hl-comment">Comment</label>
              <Textarea id="room-hl-comment" v-model="tool.comment" rows="3" maxlength="2000" placeholder="Comment" />
              <Button size="small" label="Save" @click="saveComment" />
              <Button size="small" severity="danger" text icon="pi pi-trash" label="Delete" @click="deleteHighlight" />
            </template>
          </div>
        </section>

        <div v-if="wide || tab !== 'paper'" class="card card-flush rd-side">
          <TabList v-if="wide" />
          <div :id="`room-panel-${tab}`" role="tabpanel" :aria-labelledby="`room-tab-${tab}`" class="rd-panel">
            <template v-if="tab === 'summary'">
              <template v-for="k in ['summary', ...AIDS.map(([a]) => a)] as OutputKind[]" :key="k">
                <template v-if="k === 'summary' || room.outputs[k]">
                  <h2 :class="k === 'summary' ? 'adm-visually-hidden' : 'rd-panel-title'">
                    {{ k === 'summary' ? 'Summary' : AIDS.find(([a]) => a === k)![1] }}
                  </h2>
                  <div role="status">
                    <div v-if="room.outputs[k]?.status === 'running'" class="rd-progress">
                      <p>{{ progressLine(room.outputs[k], textReady, isNb) }}</p>
                      <ProgressBar mode="indeterminate" class="rd-progress-bar" />
                    </div>
                  </div>
                  <div v-if="room.outputs[k]?.status === 'failed'" class="rd-failed">
                    <i class="pi pi-exclamation-triangle" aria-hidden="true" />
                    <p>{{ visible(room.outputs[k]!.error ?? '') }}</p>
                    <Button
                      size="small"
                      severity="secondary"
                      outlined
                      icon="pi pi-refresh"
                      label="Try again"
                      @click="generate(k)"
                    />
                  </div>
                  <template v-if="room.outputs[k]?.status === 'ready' && room.outputs[k]!.body">
                    <p v-if="outdated(room.outputs[k]!)" class="rd-muted">Papers changed since this was written.</p>
                    <ClaimList
                      :sections="room.outputs[k]!.body!.sections"
                      :papers="citeNames"
                      :known="known"
                      :scans="scans"
                      @cite="jump"
                    />
                    <div class="rd-panel-actions">
                      <Button
                        size="small"
                        severity="secondary"
                        text
                        icon="pi pi-refresh"
                        label="Regenerate"
                        @click="generate(k)"
                      />
                    </div>
                  </template>
                  <template v-if="k === 'summary' && !room.outputs.summary">
                    <div v-if="room.papers.length" class="rd-panel-actions">
                      <Button icon="pi pi-sparkles" label="Write the summary" @click="generate('summary')" />
                    </div>
                    <p v-else class="rd-muted">Add a paper to this notebook to write its summary.</p>
                  </template>
                </template>
                <template v-if="k === 'summary'">
                  <h2 class="rd-panel-title">Study aids</h2>
                  <div class="rd-panel-actions">
                    <template v-for="[a, name] in AIDS" :key="a">
                      <Button
                        v-if="!room.outputs[a]"
                        size="small"
                        severity="secondary"
                        outlined
                        :icon="a === 'faq' ? 'pi pi-question-circle' : a === 'glossary' ? 'pi pi-book' : 'pi pi-file'"
                        :label="name"
                        :disabled="!room.papers.length"
                        @click="generate(a)"
                      />
                    </template>
                  </div>
                </template>
              </template>
            </template>

            <template v-else-if="tab === 'chat'">
              <h2 class="adm-visually-hidden">Chat</h2>
              <ol class="rd-chat">
                <li v-for="m in messages" :key="m.id" :class="m.role === 'user' ? 'is-question' : 'is-answer'">
                  <p v-if="m.role === 'user'">{{ m.body }}</p>
                  <template v-else>
                    <div class="rd-bubble">
                      <AnswerText :body="m.body" :papers="citeNames" :known="known" :scans="scans" @cite="jump" />
                    </div>
                    <Button
                      size="small"
                      text
                      :severity="m.saved ? undefined : 'secondary'"
                      :icon="m.saved ? 'pi pi-bookmark-fill' : 'pi pi-bookmark'"
                      label="Save to notes"
                      :aria-pressed="m.saved"
                      @click="toggleSaved(m)"
                    />
                  </template>
                </li>
              </ol>
              <div v-if="!messages.length && !asking" class="rd-chat-empty" aria-hidden="true">
                <i class="pi pi-comments" />
              </div>
              <p v-if="asking" class="rd-thinking" role="status">
                <i class="pi pi-spin pi-spinner" aria-hidden="true" /> Thinking…
              </p>
              <p v-if="chatError" class="rd-error" role="alert">{{ chatError }}</p>
              <form class="rd-ask" @submit.prevent="ask">
                <label class="adm-visually-hidden" for="room-question">Question</label>
                <Textarea
                  id="room-question"
                  v-model="question"
                  rows="2"
                  maxlength="2000"
                  :disabled="asking"
                  placeholder="Ask about this paper"
                  @keydown="onAskKey"
                />
                <Button type="submit" icon="pi pi-send" label="Ask" :disabled="asking" />
              </form>
              <p class="rd-muted rd-use">{{ room.use.today }} of {{ room.use.cap }} AI calls used today</p>
            </template>

            <template v-else-if="tab === 'notes'">
              <h2 class="adm-visually-hidden">Notes</h2>
              <div class="rd-field">
                <label for="room-note">Note</label>
                <Textarea
                  id="room-note"
                  v-model="note"
                  rows="8"
                  maxlength="20000"
                  @input="onNoteInput"
                  @blur="saveNote"
                />
              </div>
              <p class="rd-muted rd-saved" role="status">
                <template v-if="noteStatus"><i class="pi pi-check" aria-hidden="true" /> {{ noteStatus }}</template>
              </p>
              <template v-if="room.highlights.length">
                <h3 class="rd-panel-title">Highlights</h3>
                <p id="room-hl-public-hint" class="rd-muted">Shown publicly up to 300 characters.</p>
                <ul class="rd-hls">
                  <li v-for="hl in room.highlights" :key="hl.id">
                    <span class="rd-hl-main">
                      <button type="button" class="rd-quote" @click="showHighlight(hl)">
                        “{{ visible(hl.quote) }}”
                      </button>
                      <span v-if="hl.comment" class="rd-hl-detail">{{ hl.comment }}</span>
                      <span v-if="isNb" class="rd-hl-detail">{{ paperTitle(hl.paperId) }}</span>
                      <span v-if="hlError?.id === hl.id" class="rd-hl-detail rd-error" role="alert">{{
                        hlError.text
                      }}</span>
                    </span>
                    <span class="rd-hl-public">
                      <Checkbox
                        :model-value="hl.public"
                        binary
                        :input-id="`room-hl-public-${hl.id}`"
                        :aria-label="publicLabel(hl)"
                        :pt="{ input: { 'aria-describedby': 'room-hl-public-hint' } }"
                        @update:model-value="(on: boolean) => setHighlightPublic(hl, on)"
                      />
                      <label :for="`room-hl-public-${hl.id}`">Public</label>
                    </span>
                  </li>
                </ul>
              </template>
              <template v-if="messages.some((m) => m.saved)">
                <h3 class="rd-panel-title">Saved answers</h3>
                <div class="rd-saved-answers">
                  <AnswerText
                    v-for="m in messages.filter((x) => x.saved)"
                    :key="m.id"
                    :body="m.body"
                    :papers="citeNames"
                    :known="known"
                    :scans="scans"
                    @cite="jump"
                  />
                </div>
              </template>
              <p v-if="room.vaultNote" class="rd-vault-link">
                <i class="pi pi-database" aria-hidden="true" />
                <a :href="`${base}/reading/vault/${room.vaultNote}`">{{
                  isNb ? 'Open this notebook’s note in the vault' : 'Open this paper’s note in the vault'
                }}</a>
              </p>
              <p v-else class="rd-muted">
                {{
                  isNb
                    ? 'Writing a note here adds it to the vault.'
                    : 'Saving, highlighting or writing a note here adds this paper to the vault.'
                }}
              </p>
            </template>
          </div>
        </div>
      </div>
    </template>
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
.rd-field {
  display: grid;
  gap: 0.375rem;
}
.rd-field > label {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}

/* Header card: the paper's source, authors, actions and visibility (or the notebook's title and papers). */
.rd-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  margin-block-end: 1rem;
}
.rd-head-top {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.rd-head-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 0.625rem;
  font-size: 1.25rem;
}
.rd-head-text {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}
.rd-meta,
.rd-in {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
  margin: 0;
  color: var(--app-body);
  font-size: 0.875rem;
}
.rd-in {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.rd-head-actions :deep(.rd-draft) {
  display: contents;
}
.rd-head-actions :deep(.rd-draft-hint),
.rd-head-actions :deep(.rd-draft-error) {
  flex-basis: 100%;
  max-width: none;
}
.rd-head-vis {
  display: grid;
  gap: 0.5rem;
  padding-block-start: 1rem;
  border-top: 1px dashed var(--app-border);
}
.rd-head-vis-first {
  padding-block: 0 1rem;
  border-top: 0;
  border-bottom: 1px dashed var(--app-border);
}
.rd-select-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 100%;
}
.rd-select-wrap > .pi {
  position: absolute;
  inset-inline-end: 0.75rem;
  color: var(--app-muted);
  font-size: 0.75rem;
  pointer-events: none;
}
.rd-select {
  width: auto;
  max-width: 100%;
  min-height: 2.5rem;
  padding: 0.5rem 2.25rem 0.5rem 0.75rem;
  border: 1px solid var(--p-inputtext-border-color, var(--app-border));
  border-radius: var(--p-inputtext-border-radius, 0.5rem);
  background: var(--p-inputtext-background, var(--app-card));
  color: var(--p-inputtext-color, var(--app-heading));
  font: inherit;
  font-size: 0.9375rem;
  appearance: none;
  cursor: pointer;
}
.rd-select:hover {
  border-color: var(--p-inputtext-hover-border-color, var(--app-muted));
}
.rd-select:focus-visible {
  outline: 0;
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 20%, transparent);
}
.rd-head-actions .rd-select {
  max-width: min(100%, 20rem);
}
.rd-select-full,
.rd-select-full .rd-select {
  width: 100%;
}
.rd-nb-title {
  max-width: 40rem;
}
.rd-nb-papers {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rd-nb-papers > li {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding-block: 0.625rem;
}
.rd-nb-papers > li + li {
  border-top: 1px dashed var(--app-border);
}
.rd-nb-thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
}
.rd-nb-paper {
  flex: 1;
  display: grid;
  min-width: 0;
}
.rd-nb-paper a {
  color: var(--app-heading);
  font-weight: 600;
  text-decoration: none;
}
.rd-nb-paper a:hover {
  color: var(--p-primary-color);
}
.rd-nb-sub {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-nb-add {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.rd-nb-add :deep(.p-inputtext) {
  flex: 1 1 12rem;
  max-width: 28rem;
}

/* The room: the paper (its own scroll) beside Summary · Chat · Notes from 1024px, like Conca's chat app. */
.rd-room {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.rd-paper {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.rd-side {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
@media (min-width: 1024px) {
  .rd-room {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(340px, 0.72fr);
    align-items: start;
  }
  .rd-paper,
  .rd-side {
    position: sticky;
    inset-block-start: calc(var(--app-header-height) + 1rem);
    max-block-size: calc(100dvh - var(--app-header-height) - 2rem);
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .rd-paper {
    padding: 2rem 2.5rem;
  }
}
.rd-text-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--c-info) 8%, transparent);
  color: var(--app-body);
  font-size: 0.8125rem;
}
.rd-text-label > .pi {
  color: var(--c-info);
}
.rd-text-label > p {
  flex: 1 1 16rem;
  margin: 0;
}
.rd-text-label > .rd-error {
  flex-basis: 100%;
}
.rd-upload {
  position: relative;
}
.rd-upload input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.rd-upload:focus-within {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}

/* The paper's text: a serif reading column. */
.rd-paper :deep(.adm-paper-text) {
  max-inline-size: 68ch;
  margin: 0;
  color: var(--app-heading);
  font-family: var(--font-serif);
  font-size: 1.0625rem;
  line-height: 1.7;
  overflow-wrap: break-word;
}
.rd-paper :deep(.adm-paper-text p),
.rd-paper :deep(.adm-paper-text figure) {
  margin: 0 0 1em;
}
.rd-paper :deep(.adm-paper-text :is(h3, h4, h5)) {
  margin: 1.5em 0 0.5em;
  color: var(--app-heading);
  font-family: var(--font-sans);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.35;
}
.rd-paper :deep(.adm-paper-text h3) {
  font-size: 1.1875rem;
}
.rd-paper :deep(.adm-paper-text > :first-child) {
  margin-block-start: 0;
}
.rd-paper :deep(.adm-paper-text figure) {
  padding: 0.75rem 1rem;
  border-inline-start: 3px solid var(--app-border);
  background: var(--app-canvas);
  border-radius: 0.375rem;
}
.rd-paper :deep(.adm-paper-text figcaption) {
  color: var(--app-body);
  font-size: 0.9375rem;
}
.rd-paper :deep(.adm-paper-text figure a) {
  display: inline-flex;
  align-items: center;
  min-height: 2.25rem;
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 500;
}
.rd-paper :deep(.adm-paper-text [tabindex='-1']) {
  border-radius: 0.25rem;
  transition: background-color 0.6s;
}
.rd-paper :deep(.adm-paper-text [tabindex='-1']:focus) {
  outline: none;
}
.rd-paper :deep(.adm-paper-text mark) {
  background: color-mix(in srgb, var(--c-warning) 28%, transparent);
  box-shadow: inset 0 -2px color-mix(in srgb, var(--c-warning) 80%, transparent);
  color: inherit;
  cursor: pointer;
}
/* A cited passage, for 2 s after its citation was followed. */
.rd-paper :deep(.adm-paper-text .is-flash) {
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  transition: none;
}
.rd-paper .adm-room-tool {
  position: absolute;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.375rem;
  inline-size: max-content;
  max-inline-size: min(280px, 100%);
  padding: 0.5rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  background: var(--app-card);
  box-shadow: var(--app-shadow-float);
  font-size: 0.875rem;
}
.adm-room-tool p {
  margin: 0.25rem 0.375rem;
}
.adm-room-tool :deep(textarea) {
  flex: 1 0 100%;
  font-size: 0.875rem;
}

/* The side card: tabs, then the panel. */
.rd-side :deep(.rd-tabs) {
  position: sticky;
  inset-block-start: 0;
  z-index: 2;
}
.rd-room :deep(.rd-tabs) {
  display: flex;
  gap: 0.25rem;
  padding: 0.375rem;
  border-radius: var(--app-radius-card);
  background: var(--app-card);
  box-shadow: var(--app-shadow-card);
}
.rd-side :deep(.rd-tabs) {
  margin: 0;
  border-radius: 0;
  border-bottom: 1px solid var(--app-border);
  box-shadow: none;
  padding: 0.75rem 1rem;
}
.rd-room :deep(.rd-tabs > button) {
  flex: 1;
  min-height: 2.5rem;
  padding: 0.375rem 0.875rem;
  border: 0;
  border-radius: 0.5rem;
  background: none;
  color: var(--app-body);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.rd-room :deep(.rd-tabs > button:hover) {
  background: var(--app-menu-hover);
  color: var(--app-heading);
}
.rd-room :deep(.rd-tabs > button[aria-selected='true']) {
  background: var(--p-primary-color);
  box-shadow: var(--app-shadow-active);
  color: #fff;
}
.rd-room :deep(.rd-tabs > button:focus-visible) {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}
.rd-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-inline-size: 0;
  padding: 1.25rem 1.5rem 1.5rem;
}
.rd-panel-title {
  margin: 0.5rem 0 0;
  color: var(--app-heading);
  font-size: 1rem;
  font-weight: 600;
}
.rd-panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.rd-progress {
  display: grid;
  gap: 0.5rem;
  padding: 0.875rem 1rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--p-primary-color) 7%, transparent);
}
.rd-progress p {
  margin: 0;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.rd-progress-bar {
  height: 0.25rem;
}
.rd-failed {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.5rem 0.75rem;
  padding: 0.875rem 1rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--c-danger) 8%, transparent);
  color: var(--c-danger);
}
.rd-failed > .pi {
  margin-block-start: 0.2rem;
}
.rd-failed p {
  flex: 1 1 12rem;
  margin: 0;
  font-size: 0.875rem;
}

/* Summaries and answers (RoomText's renderers). */
.rd-panel :deep(.adm-claims) {
  display: grid;
  gap: 1rem;
}
.rd-panel :deep(.adm-claims h3) {
  margin: 0 0 0.5rem;
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
}
.rd-panel :deep(.adm-claims ul) {
  display: grid;
  list-style: disc;
  gap: 0.625rem;
  margin: 0;
  padding-inline-start: 1.15em;
  color: var(--app-body);
  font-size: 0.9375rem;
  line-height: 1.55;
}
.rd-panel :deep(.adm-claims li::marker) {
  color: var(--p-primary-color);
}
.rd-panel :deep(.adm-muted) {
  color: var(--app-muted);
}
.rd-panel :deep(.adm-answer) {
  font-size: 0.9375rem;
  line-height: 1.55;
}
.rd-panel :deep(.adm-answer > :first-child) {
  margin-block-start: 0;
}
.rd-panel :deep(.adm-answer > :last-child) {
  margin-block-end: 0;
}
.rd-panel :deep(.adm-answer h4) {
  margin: 1em 0 0.4em;
  color: var(--app-heading);
  font-size: 0.9375rem;
}
.rd-panel :deep(.adm-answer :is(ul, ol)) {
  margin: 0.5em 0;
  padding-inline-start: 1.25em;
  list-style: disc;
}
.rd-panel :deep(.adm-answer ol) {
  list-style: decimal;
}
.rd-panel :deep(.adm-answer p) {
  margin: 0.5em 0;
}
.rd-panel :deep(.adm-answer code) {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}
.rd-panel :deep(.adm-cite) {
  position: relative;
  padding: 0 0.3em;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-primary-color) 10%, transparent);
  color: var(--p-primary-color);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.rd-panel :deep(button.adm-cite) {
  min-height: 0;
  text-decoration: none;
  cursor: pointer;
}
.rd-panel :deep(button.adm-cite:hover) {
  background: var(--p-primary-color);
  color: #fff;
}
/* The hit area grows to 44px without moving the line. */
.rd-panel :deep(button.adm-cite::after) {
  content: '';
  position: absolute;
  inset: -13px -4px;
}
.rd-panel :deep(button.adm-cite:focus-visible) {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}
.rd-panel :deep(button.adm-cite:disabled),
.rd-panel :deep(span.adm-cite) {
  background: var(--app-canvas);
  color: var(--app-muted);
  cursor: default;
}

/* Chat: questions right in indigo bubbles, answers left (Conca's chat). */
.rd-chat {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rd-chat > li {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
}
.rd-chat > li.is-question {
  align-items: flex-end;
}
.rd-chat .is-question p {
  max-width: 88%;
  margin: 0;
  padding: 0.625rem 0.875rem;
  border-radius: 0.75rem 0.75rem 0.25rem 0.75rem;
  background: var(--p-primary-color);
  color: #fff;
  font-size: 0.9375rem;
  font-weight: 500;
  white-space: pre-wrap;
}
.rd-bubble {
  max-width: 100%;
  padding: 0.75rem 0.875rem;
  border-radius: 0.75rem 0.75rem 0.75rem 0.25rem;
  background: var(--app-canvas);
  color: var(--app-heading);
}
.rd-chat-empty {
  display: grid;
  place-items: center;
  padding: 1.5rem 0 0.5rem;
  color: var(--app-muted);
  font-size: 2rem;
  opacity: 0.45;
}
.rd-thinking {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--app-muted);
  font-size: 0.875rem;
}
.rd-ask {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.375rem;
  border: 1px solid var(--app-border);
  border-radius: 0.875rem;
  background: var(--app-canvas);
}
.rd-ask:focus-within {
  border-color: var(--p-primary-color);
}
.rd-ask :deep(textarea) {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  resize: vertical;
}
.rd-ask :deep(textarea:focus) {
  box-shadow: none;
}
.rd-use {
  text-align: end;
}

/* Notes. */
.rd-field :deep(textarea) {
  width: 100%;
  line-height: 1.55;
}
.rd-saved {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 1.25rem;
  margin-block-start: -0.5rem;
  color: var(--c-success);
}
.rd-hls {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rd-hls > li {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding-block: 0.75rem;
}
.rd-hls > li + li {
  border-top: 1px dashed var(--app-border);
}
.rd-hl-main {
  display: grid;
  flex: 1;
  gap: 0.25rem;
  min-width: 0;
  padding-inline-start: 0.75rem;
  border-inline-start: 3px solid color-mix(in srgb, var(--c-warning) 70%, transparent);
}
.rd-quote {
  min-height: 2.75rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--app-heading);
  font-family: var(--font-serif);
  font-size: 0.9375rem;
  font-style: italic;
  text-align: start;
  cursor: pointer;
}
.rd-quote:hover {
  color: var(--p-primary-color);
}
.rd-quote:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
  border-radius: 0.25rem;
}
.rd-hl-detail {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-hl-public {
  display: flex;
  flex: none;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  font-size: 0.875rem;
}
.rd-saved-answers {
  display: grid;
  gap: 0.75rem;
}
.rd-saved-answers > :deep(.adm-answer) {
  padding: 0.75rem 0.875rem;
  border-radius: 0.625rem;
  background: var(--app-canvas);
}
.rd-vault-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--p-primary-color) 7%, transparent);
  font-size: 0.875rem;
  font-weight: 500;
}
.rd-vault-link .pi {
  color: var(--p-primary-color);
}
@media (max-width: 767.98px) {
  .rd-panel {
    padding: 1rem;
  }
  .rd-head-top {
    align-items: flex-start;
  }
  .rd-head-icon {
    display: none;
  }
}
</style>
