<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import AdminShell from './AdminShell.vue';
import { api, committed, report, toast, toastError } from './api';
import { formatDateTime, relativeTime } from './dates';
import { vDialog } from './dialog';
import {
  README,
  agentLabel,
  changedPages,
  diffLines,
  elapsed,
  explain,
  failureLine,
  groupFiles,
  providerLabel,
  stepItems,
} from './editor/site';
import type { AdminCtx } from './types';
import type { EditorStatus, PublishResult } from '../lib/admin/editor';
import { defaultCommitMessage } from '../lib/admin/editor-message';

type Busy = '' | 'start' | 'end' | 'over' | 'run' | 'stop' | 'discard' | 'publish' | 'revert' | 'undo';
type Confirm = 'publish' | 'discard' | 'over' | 'undo';

const props = defineProps<{ ctx: AdminCtx }>();
/** Desktop preview: the site laid out at this width, scaled down to the preview column. */
const DESKTOP_WIDTH = 1280;
const status = ref<EditorStatus | null>(null);
const loadError = ref('');
const busy = ref<Busy>('');
const prompt = ref('');
const promptError = ref('');
const phone = ref(false);
const confirming = ref<Confirm | null>(null);
const message = ref('');
/** The last publish from this screen: the review area ends on it until the next change. */
const published = ref<PublishResult | null>(null);
// Bumped when the preview's content changes under it (a run ended, a discard): the iframe reloads.
const previewKey = ref(0);
/** The page the preview shows, set from "Changed on". */
const previewPath = ref('/');
const now = ref(Date.now());
const promptEl = ref<HTMLTextAreaElement | null>(null);
const logEl = ref<HTMLElement | null>(null);
const doneEl = ref<HTMLElement | null>(null);
const runEl = ref<HTMLElement | null>(null);
const reviewEl = ref<HTMLElement | null>(null);
const sessionEl = ref<HTMLDetailsElement | null>(null);
const viewportEl = ref<HTMLElement | null>(null);
/** The preview column's width, from a ResizeObserver: Desktop scales a 1280px-wide page down to it. */
const viewportWidth = ref(DESKTOP_WIDTH);
/** The width presets are hidden on phones (admin.css), where the preview is the phone's own width. */
const smallScreen = window.matchMedia('(max-width: 640px)');
const small = ref(smallScreen.matches);
/** Review mode tucks the request box under "Ask for another change". */
const askOpen = ref(false);
const diffOpen = ref(false);
/** After a publish: true once this deployment (the admin's own) is built from the published commit. */
const deployed = ref(false);
/** While the status polls for that deployment: the Published line carries the working marker. */
const deploying = ref(false);
let alive = true;
/** The log follows new output until the reader scrolls up, and again once they scroll back to the end. */
let followLog = true;
let poll: ReturnType<typeof setTimeout> | undefined;
let clock: ReturnType<typeof setInterval> | undefined;

const ai = `/${props.ctx.adminPath}/ai`;
/** Everyone else can ask, run and discard; their changes wait for a publisher (site.yml `publishers`). */
const publisher = props.ctx.canPublish;
/** What a reviewer does next, in the status line. */
const decide = publisher ? 'publish or discard' : 'ask for more or discard';
const SMALL_DIFF = 150;
const shortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ Enter' : 'Ctrl Enter';
const FILE_STATUS = { added: 'new', modified: 'changed', deleted: 'deleted' } as const;
const SERVER_NOTE =
  'Changed pages (.astro files) can run code when they load. If you’re unsure, share the preview with someone technical first.';

const ready = computed(() => (status.value?.state === 'ready' ? status.value : null));
const run = computed(() => ready.value?.run);
const running = computed(() => !!run.value?.running);
const outcome = computed(() => {
  const r = run.value;
  if (!r || r.running) return null;
  return r.exitCode === 0 ? 'done' : r.exitCode === undefined ? 'stopped' : 'failed';
});
/** The last run ended without finishing: Publish stays possible, but Try again (or Discard) leads. */
const unfinished = computed(() => outcome.value === 'failed' || outcome.value === 'stopped');
const notice = computed(() => {
  const s = status.value;
  if (!s) return null;
  const raw = s.state === 'unavailable' ? s.reason : s.blocked;
  return raw ? explain(raw) : null;
});
const files = computed(() => ready.value?.files ?? []);
const allowed = computed(() => files.value.filter((f) => f.allowed));
const refused = computed(() => files.value.filter((f) => !f.allowed));
const groups = computed(() => groupFiles(files.value));
const changedOn = computed(() => changedPages(allowed.value.map((f) => f.path)));
/** In Postgres mode a publish that saves documents isn't undoable (editor.ts sets `published.undoable` to match). */
const content = computed(() => allowed.value.some((f) => f.document));
const serverCode = computed(() => allowed.value.some((f) => f.status !== 'deleted' && f.path.endsWith('.astro')));
const lines = computed(() => diffLines(ready.value?.diff ?? ''));
const timer = computed(() => (run.value?.running ? elapsed(now.value - Date.parse(run.value.startedAt)) : ''));
const reviewing = computed(() => files.value.length > 0 && !running.value);
/** This screen's last publish, until the next change: the Published panel. */
const publishedPanel = computed(() => !!published.value && !files.value.length && !running.value);
/** The server's word, so it survives a reload: the last publish was code alone, and nothing newer is unpublished. */
const undoable = computed(() => !!ready.value?.published?.undoable && !files.value.length && !running.value);
/** First use and the resting state get the full introduction; every other state keeps it behind "How this works". */
const intro = computed(() => {
  const s = status.value;
  if (!s || s.state === 'unavailable' || s.state === 'none') return true;
  return s.state === 'ready' && !s.run && !s.files.length && !published.value;
});
const failed = computed(() => (outcome.value === 'failed' ? failureLine(ready.value?.log ?? '') : ''));
/** Someone else asked for one of the changes: each request then says who asked. */
const others = computed(() => !!ready.value?.requests.some((r) => r.by !== props.ctx.user?.login));
/** Diff anchors, one per file, for the file list's links. */
const hunkIds = computed(
  () => new Map(lines.value.flatMap((l, i) => (l.file ? [[l.file, `adm-editor-hunk-${i}`] as const] : []))),
);
const live = computed(() => {
  const r = published.value;
  if (!r?.commit) return 'Your changes are live.';
  if (deployed.value) return 'Your live site is updated.';
  return props.ctx.mode === 'postgres' && r.documents?.length
    ? 'Content changes are live; code changes go live in about a minute.'
    : 'Your live site updates in about a minute.';
});
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** A path's segments, each ending in its slash: the list puts a <wbr> after each, so paths wrap only there. */
const segments = (path: string) => path.split(/(?<=\/)/);
/** Never below 0.6, where the page stops being readable: past that the preview scrolls sideways instead. */
const scale = computed(() =>
  phone.value || small.value ? 1 : Math.max(0.6, Math.min(1, viewportWidth.value / DESKTOP_WIDTH)),
);
/** A page of the preview, by route. */
const previewHref = (path: string) => (ready.value ? new URL(path, ready.value.previewUrl).href : '');

const line = computed(() => {
  if (busy.value === 'start' || busy.value === 'over')
    return 'Starting… The first start copies and installs your site, which takes about a minute.';
  if (busy.value === 'stop') return 'Stopping the agent…';
  if (busy.value === 'publish') return 'Publishing…';
  if (busy.value === 'undo') return 'Undoing the last publish…';
  const s = status.value;
  if (!s || s.state === 'unavailable') return '';
  if (s.state === 'none') return 'Not started. Start makes a private copy of your site for the agent to work in.';
  if (s.state === 'stopped') return 'Paused. Resume picks up where you left off, unpublished changes included.';
  if (running.value)
    return `Working on your request… Your live site stays as it is until ${publisher ? 'you publish' : 'it’s published'}.`;
  const sofar = files.value.length ? ' What it changed so far is below.' : '';
  if (outcome.value === 'failed') return `The agent ran into a problem and didn’t finish.${sofar}`;
  if (outcome.value === 'stopped') return 'Stopped before it finished. Whatever it changed so far is kept.';
  if (outcome.value === 'done')
    return files.value.length
      ? `Done. Check the preview, then ${decide}.`
      : 'Done, but nothing changed. Try describing the change another way.';
  if (publishedPanel.value) return '';
  if (files.value.length) return `Check the preview, then ${decide}.`;
  return 'Ready. Describe a change.';
});
/** The status line's marker: a shape per state, so colour is never the only sign. */
const tone = computed(() => {
  if (busy.value || running.value) return 'working';
  if (outcome.value === 'failed') return 'failed';
  return outcome.value === 'done' && files.value.length ? 'done' : 'ready';
});

const CONFIRM = computed(() => ({
  publish: {
    title: 'Publish these changes?',
    text: content.value
      ? 'Code changes go live in about a minute and content changes at once. A publish with content changes can’t be undone from this screen.'
      : 'Your live site updates in about a minute. You can undo this from this screen until you publish again or something else changes these files.',
    action: 'Publish',
  },
  discard: {
    title: 'Discard all changes?',
    text: 'Every file goes back to how it was when you last published or started. This can’t be undone.',
    action: 'Discard changes',
  },
  over: {
    title: 'Start over?',
    text: 'This throws away your private copy and its unpublished changes, then starts again from a fresh copy of your live site. What you already published stays.',
    action: 'Start over',
  },
  undo: {
    title: 'Undo this publish?',
    text: 'Your live site goes back to how it was before this publish, in about a minute. The undo is saved in your site’s history too, so nothing is lost.',
    action: 'Undo publish',
  },
}));

function settle(next: EditorStatus) {
  const wasRunning = running.value;
  status.value = next;
  loadError.value = '';
  if (wasRunning && !running.value) {
    previewKey.value++;
    void afterRun();
  }
  clearTimeout(poll);
  if (running.value) poll = setTimeout(load, 2000);
}

/** A run just ended: focus goes to what comes next, unless the reader already moved it somewhere that stayed. */
async function afterRun() {
  await nextTick();
  const at = document.activeElement;
  if (at && at !== document.body) return;
  (files.value.length ? reviewEl : runEl).value?.focus();
}

async function load() {
  try {
    settle(await api<EditorStatus>('editor/session'));
  } catch (e) {
    clearTimeout(poll);
    loadError.value = e instanceof Error ? e.message : String(e);
  }
}

async function act(kind: Busy, call: () => Promise<void>) {
  busy.value = kind;
  try {
    await call();
  } catch (e) {
    report(e);
  } finally {
    busy.value = '';
  }
}

const start = () => act('start', async () => settle(await api<EditorStatus>('editor/session', { method: 'POST' })));
const pause = () => act('end', async () => settle(await api<EditorStatus>('editor/session', { method: 'DELETE' })));
const stop = () => act('stop', async () => settle(await api<EditorStatus>('editor/runs', { method: 'DELETE' })));

/** Run, or Try again with the last request: the box empties only once the run has started. */
function submit(text = prompt.value) {
  if (!text.trim()) {
    promptError.value = 'Describe a change first.';
    promptEl.value?.focus();
    return;
  }
  promptError.value = '';
  void act('run', async () => {
    await api('editor/runs', { body: { prompt: text } });
    prompt.value = '';
    published.value = null;
    askOpen.value = false;
    followLog = true;
    await load();
    await nextTick();
    runEl.value?.focus();
  });
}

async function editRequest() {
  prompt.value = run.value?.prompt ?? '';
  askOpen.value = true;
  await nextTick();
  promptEl.value?.focus();
}

const onAskToggle = (e: Event) => (askOpen.value = (e.target as HTMLDetailsElement).open);

async function jump(path: string) {
  diffOpen.value = true;
  await nextTick();
  const el = document.getElementById(hunkIds.value.get(path) ?? '');
  el?.scrollIntoView({ block: 'start' });
  el?.focus({ preventScroll: true });
}

/** Polls this deployment's commit until it is the published one; gives up quietly (the text stays "about a minute"). */
async function watchDeploy(id: string) {
  deployed.value = false;
  deploying.value = true;
  try {
    for (let i = 0; i < 30 && alive && published.value?.commit?.id === id; i++) {
      const r = await api<{ commit: string | null }>('editor/deployment').catch(() => null);
      if (!r?.commit) return;
      if (r.commit === id) return void (deployed.value = true);
      await new Promise((done) => setTimeout(done, 10_000));
    }
  } finally {
    deploying.value = false;
  }
}

function onPromptKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submit();
  }
}

const revert = (path: string) =>
  act('revert', async () => {
    settle(await api<EditorStatus>('editor/revert', { body: { path } }));
    previewKey.value++;
    toast(`Undid the change to ${path}. The other changes may depend on it, so check the preview again.`);
  });

/** Closes the Session menu with focus on its button, where a confirm opened from it gives focus back. */
function closeSession() {
  const menu = sessionEl.value;
  if (!menu?.open) return;
  menu.open = false;
  menu.querySelector('summary')?.focus();
}

/** Focus moving elsewhere closes the Session menu; a click that moves no focus (Safari's) is onOutsideClick's. */
function onSessionFocusOut(e: FocusEvent) {
  const menu = sessionEl.value;
  const to = e.relatedTarget as Node | null;
  if (menu && to && !menu.contains(to)) menu.open = false;
}

function onOutsideClick(e: MouseEvent) {
  const menu = sessionEl.value;
  if (menu?.open && !menu.contains(e.target as Node)) menu.open = false;
}

async function showPage(path: string) {
  previewPath.value = path;
  await nextTick();
  viewportEl.value?.scrollIntoView({ block: 'nearest' });
}

function openPublish() {
  message.value = defaultCommitMessage((ready.value?.requests ?? []).map((r) => r.prompt));
  confirming.value = 'publish';
}

async function copySteps() {
  try {
    await navigator.clipboard.writeText(notice.value?.steps ?? '');
    toast('Setup steps copied');
  } catch {
    toastError('Couldn’t copy. The same steps are in the README, section “Site editor”.');
  }
}

async function confirmed() {
  const kind = confirming.value;
  confirming.value = null;
  if (kind === 'discard') {
    await act('discard', async () => {
      settle(await api<EditorStatus>('editor/changes', { method: 'DELETE' }));
      previewKey.value++;
    });
    await nextTick();
    promptEl.value?.focus();
  } else if (kind === 'over') {
    await act('over', async () => {
      settle(await api<EditorStatus>('editor/start-over', { method: 'POST' }));
      published.value = null;
      previewKey.value++;
    });
  } else if (kind === 'publish') {
    await act('publish', async () => {
      const r = await api<PublishResult>('editor/publish', { body: { message: message.value } });
      if (r.warning) committed({ url: r.commit?.url, warning: r.warning, tags: r.tags, detail: r.detail });
      published.value = r;
      await load();
      await nextTick();
      doneEl.value?.focus();
      if (r.commit) void watchDeploy(r.commit.id);
    });
  } else if (kind === 'undo') {
    await act('undo', async () => {
      settle(await api<EditorStatus>('editor/undo-publish', { body: { commit: ready.value?.published?.id } }));
      published.value = null;
      previewKey.value++;
      toast('Undone. Your live site goes back in about a minute.', ready.value?.published?.url);
      await nextTick();
      promptEl.value?.focus();
    });
  }
}

function onLogScroll() {
  const el = logEl.value;
  if (el) followLog = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

watch(
  () => ready.value?.log,
  async () => {
    if (!followLog) return;
    await nextTick();
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  },
);

watch(
  () => ready.value?.diff,
  () => (diffOpen.value = lines.value.length <= SMALL_DIFF),
  { immediate: true },
);

watch(running, (on) => {
  clearInterval(clock);
  now.value = Date.now();
  if (on) clock = setInterval(() => (now.value = Date.now()), 1000);
});

const onSmall = (e: MediaQueryListEvent) => (small.value = e.matches);
const resize = new ResizeObserver((entries) => (viewportWidth.value = entries[0].contentRect.width));
watch(viewportEl, (el, old) => {
  if (old) resize.unobserve(old);
  if (el) resize.observe(el);
});

onMounted(() => {
  smallScreen.addEventListener('change', onSmall);
  document.addEventListener('click', onOutsideClick);
  void load();
});
onBeforeUnmount(() => {
  alive = false;
  resize.disconnect();
  smallScreen.removeEventListener('change', onSmall);
  document.removeEventListener('click', onOutsideClick);
  clearTimeout(poll);
  clearInterval(clock);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="editor" title="Site editor">
    <template #actions>
      <!-- While a setup notice shows, Start and Start over can't work: the notice's own action is the way on. -->
      <template v-if="!notice && status">
        <Button
          v-if="status.state === 'none' || status.state === 'stopped'"
          :icon="status.state === 'stopped' ? 'pi pi-play' : 'pi pi-power-off'"
          :label="busy === 'start' ? 'Starting…' : status.state === 'stopped' ? 'Resume' : 'Start'"
          :loading="busy === 'start'"
          :disabled="!!busy"
          @click="start"
        />
        <Button
          v-if="status.state === 'stopped'"
          label="Start over…"
          severity="secondary"
          outlined
          :disabled="!!busy"
          @click="confirming = 'over'"
        />
      </template>
      <details
        v-if="ready"
        ref="sessionEl"
        class="se-session"
        @keydown.esc="closeSession"
        @focusout="onSessionFocusOut"
      >
        <summary>Session</summary>
        <div class="se-session-menu">
          <Button
            icon="pi pi-pause"
            label="Pause"
            severity="secondary"
            text
            :disabled="!!busy || running"
            @click="
              closeSession();
              pause();
            "
          />
          <Button
            v-if="!notice"
            icon="pi pi-replay"
            label="Start over…"
            severity="secondary"
            text
            :disabled="!!busy || running"
            @click="
              closeSession();
              confirming = 'over';
            "
          />
          <p v-if="running">Stop the agent first.</p>
        </div>
      </details>
    </template>

    <div class="se" :class="{ 'is-review': reviewing }">
      <component :is="intro ? 'div' : 'details'" class="card se-how" :class="{ 'is-intro': intro }">
        <summary v-if="!intro">How this works</summary>
        <div class="se-how-body">
          <span class="se-icon tint-primary" aria-hidden="true"><i class="pi pi-sparkles" /></span>
          <div class="se-how-text">
            <p class="se-intro">
              Describe a change to your site’s design or pages. A coding agent makes it in a private copy of the site,
              you check it in the preview, and {{ publisher ? 'Publish' : 'a publisher' }} puts it on your live site.
              The admin, sign-in, server code and dependencies are off limits.
            </p>
            <p v-if="!notice && publisher" class="se-muted">
              The agent is
              <template v-if="ready">{{ agentLabel(ready.provider) }}</template
              ><template v-else>your writing provider’s coding tool</template>, set on the
              <a :href="ai">Integrations screen</a>. Each run uses Vercel Sandbox time on your Vercel account and is
              billed by {{ ready ? providerLabel(ready.provider) : 'your writing provider' }} like any use of its coding
              tool.
            </p>
            <p v-if="ready && !notice" class="se-muted">
              Under Session, Pause keeps your unpublished changes for later and Start over throws them away.
            </p>
          </div>
        </div>
      </component>

      <p v-if="!status && !loadError" class="se-muted" role="status">Loading the Site editor…</p>

      <div v-if="loadError" class="se-banner is-danger" role="alert">
        <span>The Site editor’s status couldn’t load: {{ loadError }}</span>
        <Button label="Retry" size="small" severity="secondary" outlined @click="load" />
      </div>

      <!-- Setup is the publisher's job: anyone else gets one line (and Run its id for aria-describedby). -->
      <p v-if="notice && !publisher && notice.action !== 'retry'" class="se-banner">
        <span id="adm-editor-notice-title">The Site editor isn’t set up yet. Ask the site’s publisher.</span>
      </p>
      <section v-else-if="notice" class="card se-notice" aria-labelledby="adm-editor-notice-title">
        <span class="se-icon tint-warning" aria-hidden="true"><i class="pi pi-exclamation-triangle" /></span>
        <div class="se-notice-text">
          <h2 id="adm-editor-notice-title" class="card-title">{{ notice.title }}</h2>
          <p id="adm-editor-notice-body">{{ notice.body }}</p>
          <template v-if="notice.steps">
            <ol class="se-steps">
              <li v-for="(step, i) in stepItems(notice.steps)" :key="i">{{ step }}</li>
            </ol>
            <p class="se-muted">Only the person who manages the site’s hosting can do this. {{ README }}</p>
          </template>
          <details v-if="notice.body !== notice.raw" class="se-tech">
            <summary>Technical details</summary>
            <pre class="se-pre">{{ notice.raw }}</pre>
          </details>
        </div>
        <Button
          v-if="notice.action === 'copy'"
          icon="pi pi-copy"
          label="Copy setup steps"
          severity="secondary"
          outlined
          @click="copySteps"
        />
        <Button v-else-if="notice.action === 'ai'" as="a" :href="ai" label="Open the Integrations screen" />
        <Button v-else icon="pi pi-refresh" label="Try again" severity="secondary" outlined @click="load" />
      </section>

      <div v-if="line || (ready?.published && !publishedPanel && !reviewing)" class="card se-status">
        <p v-if="line" class="se-line" :class="`is-${tone}`" role="status">
          {{ line }}
        </p>
        <details v-if="failed" class="se-tech">
          <summary>Technical details</summary>
          <pre class="se-pre">{{ failed }}</pre>
        </details>
        <div v-if="run && outcome && !busy && (outcome === 'failed' || !files.length)" class="se-row">
          <Button
            v-if="outcome === 'failed'"
            icon="pi pi-replay"
            label="Try again"
            size="small"
            :disabled="!!ready?.blocked"
            @click="submit(run.prompt)"
          />
          <Button
            icon="pi pi-pencil"
            label="Edit request"
            size="small"
            severity="secondary"
            outlined
            @click="editRequest"
          />
        </div>
        <div v-if="ready?.published && !publishedPanel && !reviewing" class="se-row se-last">
          <p class="se-muted">
            Last published
            <time :datetime="ready.published.at" :title="formatDateTime(ready.published.at)">{{
              relativeTime(ready.published.at, now)
            }}</time>
            ·
            <a v-if="ready.published.url" :href="ready.published.url" target="_blank" rel="noopener"
              >see it on GitHub<span class="adm-visually-hidden"> in a new tab</span></a
            >
            <template v-else>{{ ready.published.id.slice(0, 7) }}</template>
          </p>
          <Button
            v-if="undoable && publisher"
            label="Undo this publish…"
            size="small"
            severity="secondary"
            outlined
            :disabled="!!busy"
            @click="confirming = 'undo'"
          />
        </div>
      </div>

      <template v-if="ready">
        <section v-if="published && publishedPanel" class="card se-done" aria-labelledby="adm-editor-done">
          <span class="se-icon tint-success" aria-hidden="true"><i class="pi pi-check" /></span>
          <div class="se-done-text">
            <h2 id="adm-editor-done" ref="doneEl" class="card-title" tabindex="-1">Published</h2>
            <p
              class="se-line"
              :class="deploying ? 'is-working' : deployed || !published.commit ? 'is-done' : 'is-ready'"
              role="status"
            >
              {{ live }}
            </p>
            <div class="se-row">
              <Button as="a" href="/" target="_blank" rel="noopener" severity="secondary" outlined size="small">
                View live site<span class="adm-visually-hidden"> in a new tab</span> <span aria-hidden="true">↗</span>
              </Button>
              <Button
                v-if="undoable && publisher"
                label="Undo this publish…"
                size="small"
                severity="secondary"
                outlined
                :disabled="!!busy"
                @click="confirming = 'undo'"
              />
              <a v-if="published.commit?.url" :href="published.commit.url" target="_blank" rel="noopener">
                See the change on GitHub ({{ published.commit.id.slice(0, 7) }})<span class="adm-visually-hidden">
                  in a new tab</span
                >
              </a>
            </div>
            <p v-if="!undoable" class="se-muted">To undo it, ask for the change back and publish again.</p>
          </div>
        </section>

        <div class="se-work" :class="{ 'is-review': reviewing }">
          <div class="se-grid">
            <div class="se-rail">
              <div class="card se-chat">
                <div class="se-chat-head">
                  <span class="se-avatar tint-primary" aria-hidden="true"><i class="pi pi-sparkles" /></span>
                  <span class="se-chat-who">
                    <strong>{{ agentLabel(ready.provider) }}</strong>
                    <span>{{ ready.model }}</span>
                  </span>
                  <span v-if="running" class="se-chat-dot" aria-hidden="true" />
                </div>
                <div class="se-chat-body">
                  <section v-if="reviewing" class="se-review" aria-labelledby="adm-editor-changes">
                    <h2 id="adm-editor-changes" ref="reviewEl" class="se-h2" tabindex="-1">Review the changes</h2>
                    <p v-if="changedOn.every || changedOn.pages.length" class="se-pages">
                      Changed on:
                      {{ changedOn.every ? `every page${changedOn.pages.length ? ', including' : ''}` : '' }}
                      <template v-for="(p, i) in changedOn.pages" :key="`${p.path} ${p.label}`">
                        <template v-if="i">, </template>
                        <a
                          :href="previewHref(p.path)"
                          :aria-current="p.path === previewPath ? 'true' : undefined"
                          @click.prevent="showPage(p.path)"
                          >{{ p.label }}</a
                        >
                      </template>
                    </p>
                    <div v-if="ready.requests.length" class="se-group">
                      <h3 class="se-h3">{{ others ? 'Asked for' : 'You asked for' }}</h3>
                      <ol class="se-messages">
                        <li v-for="(r, i) in ready.requests" :key="i">
                          <p class="se-bubble is-mine">{{ r.prompt }}</p>
                          <p v-if="r.by !== ctx.user?.login" class="se-by" dir="auto">
                            Asked by {{ r.byName || r.by }}
                          </p>
                          <p v-if="r.summary" class="se-bubble is-agent">
                            <span class="se-summary-label">What changed:</span> {{ r.summary }}
                          </p>
                        </li>
                      </ol>
                      <details v-if="run" class="se-logbox" :open="outcome === 'failed'">
                        <summary>Agent log</summary>
                        <pre
                          ref="logEl"
                          class="se-pre se-log"
                          tabindex="0"
                          aria-label="Agent log"
                          @scroll.passive="onLogScroll"
                          >{{ ready.log || 'No output.' }}</pre
                        >
                      </details>
                    </div>
                    <div v-for="g in groups" :key="g.kind" class="se-group">
                      <h3 class="se-h3" :class="{ 'is-refused': g.kind === 'refused' }">
                        {{ g.label }}
                        <span :class="['chip', g.kind === 'refused' ? 'chip-danger' : 'chip-secondary']">{{
                          g.files.length
                        }}</span>
                      </h3>
                      <p v-if="g.kind === 'refused'" class="se-muted">
                        The editor may not change the admin, sign-in, server code, dependencies or build settings. Undo
                        these files to publish the rest.
                      </p>
                      <ul class="se-files">
                        <li v-for="f in g.files" :key="f.path">
                          <a
                            v-if="hunkIds.has(f.path)"
                            class="se-file"
                            :href="`#${hunkIds.get(f.path)}`"
                            @click.prevent="jump(f.path)"
                            ><code
                              ><template v-for="(s, i) in segments(f.path)" :key="i">{{ s }}<wbr /></template></code
                            ><span class="adm-visually-hidden">, show its changes</span></a
                          >
                          <code v-else class="se-file"
                            ><template v-for="(s, i) in segments(f.path)" :key="i">{{ s }}<wbr /></template
                          ></code>
                          <span class="se-file-status"
                            ><span
                              :class="[
                                'chip',
                                f.status === 'added'
                                  ? 'chip-success'
                                  : f.status === 'deleted'
                                    ? 'chip-danger'
                                    : 'chip-info',
                              ]"
                              >{{ FILE_STATUS[f.status] }}</span
                            ><template v-if="f.binary"> · a file you can’t preview</template></span
                          >
                          <Button
                            v-if="!f.allowed"
                            size="small"
                            severity="danger"
                            outlined
                            :disabled="!!busy"
                            @click="revert(f.path)"
                          >
                            Undo this file<span class="adm-visually-hidden">: {{ f.path }}</span>
                          </Button>
                        </li>
                      </ul>
                    </div>
                  </section>

                  <section
                    v-if="run && !reviewing"
                    ref="runEl"
                    class="se-run"
                    tabindex="-1"
                    aria-labelledby="adm-editor-run"
                  >
                    <h2 id="adm-editor-run" class="se-h2">Your request</h2>
                    <p class="se-bubble is-mine">{{ run.prompt }}</p>
                    <p v-if="run.summary" class="se-bubble is-agent">
                      <span class="se-summary-label">What the agent said:</span> {{ run.summary }}
                    </p>
                    <div v-if="run.running" class="se-row">
                      <Button
                        icon="pi pi-stop-circle"
                        label="Stop"
                        size="small"
                        severity="danger"
                        outlined
                        :disabled="busy === 'stop'"
                        @click="stop"
                      />
                      <span class="se-elapsed"
                        >Running for <span class="se-time">{{ timer }}</span></span
                      >
                    </div>
                    <details class="se-logbox" :open="run.running || outcome === 'failed'">
                      <summary>Agent log</summary>
                      <pre
                        ref="logEl"
                        class="se-pre se-log"
                        tabindex="0"
                        aria-label="Agent log"
                        @scroll.passive="onLogScroll"
                        >{{ ready.log || 'Waiting for output…' }}</pre
                      >
                    </details>
                  </section>

                  <div v-if="!reviewing && !run" class="se-chat-empty" aria-hidden="true">
                    <i class="pi pi-comments" />
                  </div>
                </div>

                <component
                  :is="reviewing ? 'details' : 'div'"
                  v-if="!running"
                  class="se-ask"
                  v-bind="reviewing ? { open: askOpen } : {}"
                  @toggle="onAskToggle"
                >
                  <summary v-if="reviewing">Ask for another change</summary>
                  <form novalidate @submit.prevent="submit()">
                    <label for="adm-editor-prompt" class="se-ask-label">{{
                      reviewing ? 'What else should change?' : 'What should change?'
                    }}</label>
                    <div class="se-composer">
                      <textarea
                        id="adm-editor-prompt"
                        ref="promptEl"
                        v-model="prompt"
                        rows="3"
                        placeholder="Make the header serif and move the news section above publications"
                        :disabled="!!ready.blocked"
                        :aria-invalid="promptError ? 'true' : undefined"
                        :aria-describedby="promptError ? 'adm-editor-prompt-error' : undefined"
                        @input="promptError = ''"
                        @keydown="onPromptKey"
                      />
                      <div class="se-composer-bar">
                        <span class="se-kbd" aria-hidden="true"
                          ><kbd>{{ shortcut }}</kbd></span
                        >
                        <Button
                          type="submit"
                          icon="pi pi-send"
                          :label="busy === 'run' ? 'Starting…' : 'Run'"
                          :severity="reviewing ? 'secondary' : undefined"
                          :outlined="reviewing"
                          size="small"
                          :disabled="!!busy || !!ready.blocked"
                          :aria-describedby="ready.blocked ? 'adm-editor-notice-title' : undefined"
                          aria-keyshortcuts="Meta+Enter Control+Enter"
                        />
                      </div>
                    </div>
                    <p v-if="promptError" id="adm-editor-prompt-error" class="se-err">{{ promptError }}</p>
                  </form>
                </component>
              </div>

              <div
                v-if="reviewing"
                class="se-bar"
                role="region"
                :aria-label="publisher ? 'Publish or discard' : 'Changes waiting for review'"
              >
                <div class="se-bar-text">
                  <p id="adm-editor-bar-text">
                    {{ plural(files.length, 'file changed', 'files changed') }}
                    <template v-if="refused.length && publisher">
                      ·
                      <span class="se-err-inline"
                        >undo {{ plural(refused.length, 'refused file', 'refused files') }} to publish</span
                      >
                    </template>
                    <template v-if="unfinished"> · The last run didn’t finish.</template>
                  </p>
                  <p v-if="!publisher" class="se-bar-review">
                    Ready for review: a publisher publishes this{{
                      refused.length ? ' once the refused files are undone' : ''
                    }}.
                  </p>
                </div>
                <Button
                  label="Discard…"
                  :severity="outcome === 'stopped' ? undefined : 'secondary'"
                  :outlined="outcome !== 'stopped'"
                  :disabled="!!busy"
                  @click="confirming = 'discard'"
                />
                <Button
                  v-if="publisher"
                  icon="pi pi-check"
                  :label="busy === 'publish' ? 'Publishing…' : 'Publish…'"
                  :severity="unfinished ? 'secondary' : undefined"
                  :outlined="unfinished"
                  :disabled="!!busy || refused.length > 0 || !!ready.blocked"
                  :aria-describedby="refused.length || unfinished ? 'adm-editor-bar-text' : undefined"
                  @click="openPublish"
                />
              </div>
            </div>

            <section class="card card-flush se-preview" aria-labelledby="adm-editor-preview">
              <div class="card-head">
                <div class="se-preview-title">
                  <h2 id="adm-editor-preview" class="card-title">
                    <i class="pi pi-desktop text-primary" aria-hidden="true" /> Preview
                  </h2>
                  <p v-if="running" class="card-subtitle">Updates when the agent finishes.</p>
                </div>
                <div class="se-row">
                  <div class="se-widths" role="group" aria-label="Preview width">
                    <button type="button" :aria-pressed="!phone" @click="phone = false">
                      <i class="pi pi-desktop" aria-hidden="true" /> Desktop (scaled)
                    </button>
                    <button type="button" :aria-pressed="phone" @click="phone = true">
                      <i class="pi pi-mobile" aria-hidden="true" /> Phone
                    </button>
                  </div>
                  <a class="se-open" :href="previewHref(previewPath)" target="_blank" rel="noopener">
                    Open preview<span class="adm-visually-hidden"> in a new tab</span> <span aria-hidden="true">↗</span>
                  </a>
                </div>
              </div>
              <div class="se-stage">
                <div
                  ref="viewportEl"
                  class="se-viewport"
                  :class="{ 'is-phone': phone && !small }"
                  :style="{
                    '--adm-preview-scale': scale,
                    '--adm-preview-width': phone || small ? '' : `${DESKTOP_WIDTH}px`,
                  }"
                >
                  <div class="se-frame">
                    <iframe
                      :key="previewKey"
                      :src="previewHref(previewPath)"
                      title="Preview of the edited site"
                      sandbox="allow-scripts allow-same-origin allow-forms"
                    />
                  </div>
                </div>
              </div>
            </section>

            <details
              v-if="reviewing"
              class="card se-diffbox"
              :open="diffOpen"
              @toggle="diffOpen = ($event.target as HTMLDetailsElement).open"
            >
              <summary>
                <i class="pi pi-code text-primary" aria-hidden="true" />
                {{ lines.length <= SMALL_DIFF ? 'Diff' : `Show the full diff (${lines.length} lines)` }}
              </summary>
              <pre class="se-pre se-diff" tabindex="0" aria-label="Diff"><span
              v-for="(l, i) in lines"
              :id="l.file && hunkIds.get(l.file)"
              :key="i"
              :class="`is-${l.kind}`"
              :tabindex="l.file ? -1 : undefined"
            >{{ l.text || ' ' }}</span></pre>
              <p v-if="ready.diffTruncated" class="se-muted">
                The diff is over 200 KB, so only its start is shown. The file list above is complete.
              </p>
            </details>
          </div>
        </div>
      </template>
    </div>

    <div
      v-if="confirming"
      v-dialog
      class="se-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adm-editor-confirm"
      @keydown.esc="confirming = null"
    >
      <div class="se-modal-box">
        <form class="se-confirm" @submit.prevent="confirmed">
          <h2 id="adm-editor-confirm" class="card-title">{{ CONFIRM[confirming].title }}</h2>
          <p>{{ CONFIRM[confirming].text }}</p>
          <template v-if="confirming === 'publish' && ready">
            <div v-if="ready.requests.length">
              <h3 class="se-h3">{{ others ? 'Asked for' : 'You asked for' }}</h3>
              <ol class="se-messages">
                <li v-for="(r, i) in ready.requests" :key="i">
                  <p class="se-bubble is-mine">{{ r.prompt }}</p>
                  <p v-if="r.by !== ctx.user?.login" class="se-by" dir="auto">Asked by {{ r.byName || r.by }}</p>
                  <p v-if="r.summary" class="se-bubble is-agent">
                    <span class="se-summary-label">What changed:</span> {{ r.summary }}
                  </p>
                </li>
              </ol>
            </div>
            <div>
              <h3 class="se-h3">{{ plural(allowed.length, 'file', 'files') }}</h3>
              <ul class="se-confirm-files">
                <li v-for="f in allowed" :key="f.path">
                  <code
                    ><template v-for="(s, i) in segments(f.path)" :key="i">{{ s }}<wbr /></template
                  ></code>
                  <span class="se-muted">{{ FILE_STATUS[f.status] }}</span>
                </li>
              </ul>
            </div>
            <p v-if="unfinished" class="se-banner">
              <span>The last run didn’t finish, so these changes may be incomplete. Check the preview first.</span>
            </p>
            <p v-if="serverCode" class="se-banner">
              <span>{{ SERVER_NOTE }}</span>
            </p>
            <a :href="previewHref(previewPath)" target="_blank" rel="noopener">
              Open preview<span class="adm-visually-hidden"> in a new tab</span> <span aria-hidden="true">↗</span>
            </a>
            <details class="se-details">
              <summary>Details</summary>
              <label class="se-field">
                <span>Note for the change history</span>
                <InputText v-model="message" type="text" fluid />
                <small>Shown in your site’s history on GitHub.</small>
              </label>
            </details>
          </template>
          <div class="se-modal-actions">
            <Button label="Cancel" severity="secondary" outlined data-autofocus @click="confirming = null" />
            <Button
              type="submit"
              :label="CONFIRM[confirming].action"
              :severity="confirming === 'publish' || confirming === 'undo' ? undefined : 'danger'"
            />
          </div>
        </form>
      </div>
    </div>
  </AdminShell>
</template>

<style scoped>
.se {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-width: 0;
}
.se p {
  margin: 0;
}
.se-muted {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.se-err,
.se-err-inline {
  color: var(--c-danger);
}
.se-err {
  margin: 0.375rem 0 0;
  font-size: 0.8125rem;
}
.se-icon,
.se-avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 50%;
  font-size: 1.125rem;
}
.se-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}
.se-h2 {
  margin: 0;
  color: var(--app-heading);
  font-size: 1rem;
  font-weight: 600;
}
.se-h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 600;
}
.se-h3.is-refused {
  color: var(--c-danger);
}
/* Headings script focuses (after a run, after Publish) are landmarks for screen readers, not targets: no box. */
.se h2[tabindex='-1']:focus,
.se-run:focus {
  outline: none;
}
.se-pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  white-space: pre-wrap;
}
details > summary {
  cursor: pointer;
}

/* Session menu (a details popover). */
.se-session {
  position: relative;
}
.se-session > summary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.625rem;
  padding: 0 1rem;
  border: 1px solid var(--p-button-outlined-secondary-border-color, var(--app-border));
  border-radius: var(--p-button-border-radius, 0.5rem);
  color: var(--app-heading);
  font-weight: 500;
  list-style: none;
  user-select: none;
}
.se-session > summary::-webkit-details-marker {
  display: none;
}
.se-session > summary::after {
  content: '\e902';
  font-family: primeicons;
  font-size: 0.75rem;
  transition: transform 0.2s;
}
.se-session[open] > summary::after {
  transform: rotate(180deg);
}
.se-session > summary:hover {
  background: var(--app-menu-hover);
}
.se-session-menu {
  position: absolute;
  inset-inline-end: 0;
  inset-block-start: calc(100% + 0.375rem);
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-inline-size: 13rem;
  padding: 0.375rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  background: var(--app-card);
  box-shadow: var(--app-shadow-float);
}
.se-session-menu :deep(.p-button) {
  justify-content: flex-start;
}
.se-session-menu p {
  margin: 0;
  padding: 0.375rem 0.75rem;
  color: var(--app-muted);
  font-size: 0.8125rem;
}

/* Introduction ("How this works" once there is something to show). */
.se-how {
  padding-block: 1.25rem;
}
.se-how > summary {
  color: var(--app-muted);
  font-size: 0.875rem;
  font-weight: 500;
}
details.se-how[open] > summary {
  margin-block-end: 1rem;
}
.se-how-body {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}
.se-how-text {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-inline-size: 46rem;
}
.se-intro {
  color: var(--app-heading);
  font-size: 0.9375rem;
  line-height: 1.6;
}

.se-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--c-warning) 12%, var(--app-card));
  box-shadow: inset 4px 0 0 var(--c-warning);
  color: var(--app-heading);
  font-size: 0.875rem;
}
.se-banner.is-danger {
  background: color-mix(in srgb, var(--c-danger) 8%, var(--app-card));
  box-shadow: inset 4px 0 0 var(--c-danger);
}

/* Setup notice. */
.se-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 1rem 1.25rem;
  box-shadow:
    inset 4px 0 0 var(--c-warning),
    var(--app-shadow-card);
}
.se-notice-text {
  display: flex;
  flex: 1 1 26rem;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}
.se-notice-text > p {
  max-inline-size: 65ch;
  font-size: 0.9375rem;
}
.se-steps {
  margin: 0.25rem 0;
  padding-inline-start: 1.25rem;
  max-inline-size: 65ch;
  list-style: decimal;
  font-size: 0.875rem;
}
.se-steps > li + li {
  margin-block-start: 0.375rem;
}
.se-steps > li::marker {
  color: var(--p-primary-color);
  font-weight: 600;
}
.se-tech > summary {
  inline-size: fit-content;
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.se-tech pre {
  margin-block-start: 0.5rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: var(--app-canvas);
  overflow-wrap: anywhere;
}

/* Status line: a drawn marker per state (working, done, failed, ready), so the state never rests on colour alone. */
.se-status {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-block: 1rem;
}
.se-line {
  display: flex;
  gap: 0.625rem;
  color: var(--app-heading);
  font-weight: 500;
}
.se-line::before {
  content: '';
  flex: none;
  inline-size: 1rem;
  block-size: 1rem;
  margin-block-start: 0.2em;
  background: currentColor;
  mask: var(--se-mark) center / contain no-repeat;
}
.se-line.is-working::before {
  --se-mark: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M8 2a6 6 0 1 1-6 6'/></svg>");
  color: var(--p-primary-color);
  animation: se-spin 0.9s linear infinite;
}
.se-line.is-done::before {
  --se-mark: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 8.5l3.2 3.2L13 4.5'/></svg>");
  color: var(--c-success);
}
.se-line.is-failed {
  color: var(--c-danger);
}
.se-line.is-failed::before {
  --se-mark: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='8' cy='8' r='6.5'/><path d='M8 4.5v4.2M8 11.4v.1'/></svg>");
}
.se-line.is-ready::before {
  --se-mark: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='8' cy='8' r='5'/></svg>");
  color: var(--app-muted);
}
@keyframes se-spin {
  to {
    transform: rotate(1turn);
  }
}
@media (prefers-reduced-motion: reduce) {
  .se-line.is-working::before {
    animation: none;
  }
}
.se-last {
  padding-block-start: 0.75rem;
  border-top: 1px dashed var(--app-border);
}

.se-done {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  box-shadow:
    inset 4px 0 0 var(--c-success),
    var(--app-shadow-card);
}
.se-done-text {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* Work area: the agent conversation beside the preview (Conca's chat app); stacked while the preview wouldn't fit. */
.se-work {
  container-type: inline-size;
  min-width: 0;
}
.se-grid {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
/* Stacked: the bar's sticky range is the whole work area, so it stays in reach over the preview and diff. */
.se-rail {
  display: contents;
}
.se-chat {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  overflow: hidden;
}
.se-chat-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-canvas) 60%, var(--app-card));
}
.se-avatar {
  width: 2.5rem;
  height: 2.5rem;
  font-size: 1rem;
}
.se-chat-who {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}
.se-chat-who strong {
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
}
.se-chat-who span {
  overflow: hidden;
  color: var(--app-muted);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.se-chat-dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
  background: var(--c-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-success) 25%, transparent);
}
.se-chat-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1.25rem;
  min-height: 0;
  padding: 1.25rem;
}
.se-chat-body:has(.se-chat-empty) {
  justify-content: center;
}
.se-chat-empty {
  display: grid;
  place-items: center;
  min-height: 8rem;
}
.se-chat-empty .pi {
  display: grid;
  place-items: center;
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
  color: color-mix(in srgb, var(--p-primary-color) 55%, var(--app-card));
  font-size: 1.75rem;
}
.se-review,
.se-run {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.se-pages {
  font-size: 0.875rem;
}
.se-pages a[aria-current] {
  color: var(--app-heading);
  font-weight: 600;
}
.se-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* Chat bubbles: the request on the right, the agent's account on the left. */
.se-messages {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.se-messages > li {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.se-bubble {
  max-inline-size: 90%;
  padding: 0.625rem 0.875rem;
  border-radius: 0.875rem;
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.se-bubble.is-mine {
  align-self: flex-end;
  border-end-end-radius: 0.25rem;
  background: var(--p-primary-color);
  color: #fff;
}
.se-bubble.is-agent {
  align-self: flex-start;
  border-end-start-radius: 0.25rem;
  background: var(--app-canvas);
  color: var(--app-heading);
}
.se-summary-label {
  font-weight: 600;
}
.se-by {
  align-self: flex-end;
  color: var(--app-muted);
  font-size: 0.75rem;
}
.se-elapsed {
  color: var(--app-muted);
  font-size: 0.875rem;
}
.se-time {
  color: var(--app-heading);
  font-variant-numeric: tabular-nums;
}
.se-logbox > summary {
  inline-size: fit-content;
  color: var(--app-heading);
  font-size: 0.8125rem;
  font-weight: 500;
}
.se-log,
.se-diff {
  max-height: 40vh;
  overflow: auto;
  padding: 0.875rem 1rem;
  border-radius: 0.5rem;
}
.se-log {
  margin-block-start: 0.5rem;
  background: #1b1a24;
  color: #d9d8e3;
}

/* Changed files. */
.se-files {
  margin: 0;
  padding: 0;
  list-style: none;
}
.se-files > li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem 0.75rem;
  padding-block: 0.5rem;
}
.se-files > li + li {
  border-top: 1px dashed var(--app-border);
}
/* Paths break after a slash (the <wbr>); mid-segment only when one segment can't fit. */
.se-file {
  flex: 1 1 12rem;
  min-width: 0;
  overflow-wrap: break-word;
  font-size: 0.8125rem;
}
.se-file code,
code.se-file {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  overflow-wrap: break-word;
}
.se-file-status {
  color: var(--app-muted);
  font-size: 0.75rem;
}

/* Composer: the request box at the foot of the conversation. */
.se-ask {
  padding: 1rem 1.25rem 1.25rem;
  border-top: 1px solid var(--app-border);
}
.se-ask > summary {
  inline-size: fit-content;
  color: var(--p-primary-color);
  font-size: 0.875rem;
  font-weight: 600;
}
details.se-ask[open] > summary {
  margin-block-end: 0.75rem;
}
.se-ask-label {
  display: block;
  margin-block-end: 0.5rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.se-composer {
  border: 1px solid var(--app-border);
  border-radius: 0.75rem;
  background: var(--app-canvas);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.se-composer:focus-within {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}
.se-composer textarea {
  display: block;
  width: 100%;
  min-height: 4.5rem;
  padding: 0.75rem 0.875rem 0.25rem;
  border: 0;
  outline: 0;
  background: none;
  color: var(--app-heading);
  font: inherit;
  font-size: 0.9375rem;
  resize: vertical;
}
.se-composer textarea::placeholder {
  color: var(--app-muted);
}
.se-composer textarea:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.se-composer textarea[aria-invalid='true'] {
  box-shadow: inset 0 -2px 0 var(--c-danger);
}
.se-composer-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.375rem 0.5rem 0.5rem;
}
.se-kbd kbd {
  padding: 0.0625rem 0.375rem;
  border: 1px solid var(--app-border);
  border-radius: 0.25rem;
  background: var(--app-card);
  color: var(--app-muted);
  font-family: var(--font-sans);
  font-size: 0.6875rem;
}
@media (pointer: coarse), (max-width: 640px) {
  .se-kbd {
    display: none;
  }
}

/* Discard and Publish stay in reach while the preview and diff scroll past. */
.se-bar {
  position: sticky;
  inset-block: calc(var(--app-header-height) + 0.75rem) 0.75rem;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.75rem 0.75rem 0.75rem 1.25rem;
  border-radius: var(--app-radius-card);
  background: var(--app-card);
  box-shadow:
    0 0 0 1px var(--app-border),
    var(--app-shadow-float);
}
.se-bar-text {
  flex: 1 1 14rem;
  font-size: 0.875rem;
}
.se-bar-text p {
  color: var(--app-heading);
}
.se-bar-review {
  font-weight: 500;
}

/* Preview. */
.se-preview > .card-head {
  padding-block: 0.875rem;
}
.se-preview-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.75rem;
}
.se-widths {
  display: inline-flex;
  padding: 0.1875rem;
  border-radius: 0.5rem;
  background: var(--app-canvas);
}
.se-widths button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.3125rem 0.625rem;
  border: 0;
  border-radius: 0.375rem;
  background: none;
  color: var(--app-body);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}
.se-widths button[aria-pressed='true'] {
  background: var(--app-card);
  box-shadow: var(--app-shadow-card);
  color: var(--p-primary-color);
}
/* The width presets are hidden on phones, where the preview is the phone's own width. */
@media (max-width: 640px) {
  .se-widths {
    display: none;
  }
}
.se-open {
  font-size: 0.8125rem;
  font-weight: 500;
}
.se-stage {
  padding: 1rem;
  background: var(--app-canvas);
}
@media (max-width: 640px) {
  .se-stage {
    padding: 0.5rem;
  }
}
/*
 * Desktop lays the site out 1280px wide (--adm-preview-width) and scales it to the column (--adm-preview-scale, set
 * from its width, never below 0.6); a column narrower than that scrolls sideways.
 */
.se-viewport {
  block-size: 70vh;
  overflow: auto hidden;
  border: 1px solid var(--app-border);
  border-radius: 0.5rem;
  background: #fff;
  box-shadow: var(--app-shadow-card);
}
.se-viewport.is-phone {
  inline-size: min(390px, 100%);
  margin-inline: auto;
  border-radius: 1.25rem;
}
/* The page's scaled size: it clips the iframe's unscaled box, which would otherwise widen the scroll range. */
.se-frame {
  inline-size: calc(var(--adm-preview-width, 100%) * var(--adm-preview-scale, 1));
  block-size: 100%;
  overflow: hidden;
}
.se-frame > iframe {
  display: block;
  inline-size: var(--adm-preview-width, 100%);
  block-size: calc(100% / var(--adm-preview-scale, 1));
  border: 0;
  transform: scale(var(--adm-preview-scale, 1));
  transform-origin: 0 0;
}
.se-frame > iframe:dir(rtl) {
  transform-origin: 100% 0;
}

/* Diff. */
.se-diffbox > summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  inline-size: fit-content;
  color: var(--app-heading);
  font-size: 1rem;
  font-weight: 600;
}
.se-diffbox > pre {
  max-height: 60vh;
  margin-block: 1rem 0;
  background: var(--app-canvas);
}
.se-diffbox > p {
  margin-block-start: 0.5rem;
}
.se-diff > span {
  display: block;
}
.se-diff .is-add {
  background: color-mix(in srgb, var(--c-success) 12%, transparent);
  color: var(--c-success);
}
.se-diff .is-del {
  background: color-mix(in srgb, var(--c-danger) 8%, transparent);
  color: var(--c-danger);
}
.se-diff .is-hunk {
  color: var(--p-primary-color);
}
.se-diff .is-meta {
  color: var(--app-muted);
  font-weight: 500;
}

/*
 * Side by side once 19rem of conversation, the gap and the preview at its 0.6 floor (768px) fit; the conversation
 * grows toward 26rem only from what the preview doesn't need.
 */
@container (min-width: 69rem) {
  .se-grid {
    display: grid;
    grid-template-columns: clamp(19rem, 100% - 800px, 26rem) minmax(0, 1fr);
    align-items: stretch;
  }
  .se-rail {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }
  .se-rail > .se-chat {
    flex: 1;
  }
  .se-preview {
    position: sticky;
    inset-block-start: calc(var(--app-header-height) + 1rem);
    align-self: start;
  }
  .se-diffbox {
    grid-column: 1 / -1;
  }
}
</style>
