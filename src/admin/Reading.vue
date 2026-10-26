<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Skeleton from 'primevue/skeleton';
import AdminShell from './AdminShell.vue';
import StatCard from './ui/StatCard.vue';
import DigestRow from './ui/reading/DigestRow.vue';
import ReadingNav from './ui/reading/ReadingNav.vue';
import { api, report, toast } from './api';
import { formatDate, relativeTime } from './dates';
import { isRunning, visible } from './career';
import { SOURCE_NAMES, dayLine, readingRunLine, readingRunNotes, thinLine } from './reading';
import type { AdminCtx } from './types';
import type { ReadingPrefs } from '../lib/reading/settings';
import type { DigestItem, DigestSection, PaperState, ReadingRun } from '../lib/reading/types';

// Titles, authors and lines are third-party text (or the AI's): shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const SECTIONS: [DigestSection, string][] = [
  ['talked', 'People are talking about'],
  ['field', 'New in your field'],
  ['unranked', 'Not ranked tonight'],
];
const WEEK = 7;

interface Day {
  day: string;
  items: DigestItem[];
}
interface RunStatus {
  runId: string | null;
  status: string | null;
  lastRun: ReadingRun | null;
}

const days = ref<Day[]>([]);
const more = ref(false);
const loading = ref(true);
const loadingMore = ref(false);
const prefs = ref<ReadingPrefs | null>(null);
const run = ref<RunStatus>({ runId: null, status: null, lastRun: null });
const runKnown = ref(false);
const starting = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
const running = computed(() => starting.value || isRunning(run.value.status));

const newest = computed(() => days.value[0] ?? null);
const earlier = computed(() => days.value.slice(1).filter((d) => d.items.length));
const inSection = (d: Day, s: DigestSection) => d.items.filter((i) => i.section === s);
/** Under a short section of the newest day: why it is short, only when the last run built that day. */
function thin(s: DigestSection): string | null {
  const last = run.value.lastRun;
  if (s === 'unranked' || !prefs.value || !newest.value || last?.day !== newest.value.day) return null;
  const max = s === 'talked' ? prefs.value.talked : prefs.value.inField;
  return thinLine(s, inSection(newest.value, s).length, max, prefs.value.area, last);
}
// The stat tiles: the newest day's digest, read from what the page already loaded.
const SECTION_LOOK: Record<DigestSection, { icon: string; tint: string }> = {
  talked: { icon: 'pi-comments', tint: 'pink' },
  field: { icon: 'pi-star', tint: 'primary' },
  unranked: { icon: 'pi-list', tint: 'secondary' },
};
const tile = (n: number | undefined) => (loading.value || n === undefined ? '–' : String(n));
const savedCount = computed(
  () =>
    new Set(days.value.flatMap((d) => d.items.filter((i) => i.paper.state === 'saved').map((i) => i.paper.id))).size,
);

/** The newest day and a week before it in one request; later pages a week at a time. */
async function load(before?: string) {
  const n = before ? WEEK : WEEK + 1;
  try {
    const res = await api<{ days: Day[] }>(`reading/digest?days=${n}${before ? `&before=${before}` : ''}`);
    days.value = before ? [...days.value, ...res.days] : res.days;
    more.value = res.days.length === n;
  } catch (e) {
    report(e);
  } finally {
    loading.value = false;
  }
}
async function showEarlier() {
  loadingMore.value = true;
  await load(days.value.at(-1)!.day);
  loadingMore.value = false;
}

async function setState(id: number, state: PaperState) {
  await api(`reading/papers/${id}`, { method: 'PATCH', body: { state } });
  for (const d of days.value) for (const i of d.items) if (i.paper.id === id) i.paper.state = state;
}
async function toggleSave(i: DigestItem) {
  try {
    await setState(i.paper.id, i.paper.state === 'saved' ? 'new' : 'saved');
  } catch (e) {
    report(e);
  }
}

const rowKey = (d: Day, i: DigestItem) => `${d.day}-${i.paper.id}`;
function focusIn(key: string | null, selector: string) {
  void nextTick(() => {
    const row = key ? document.querySelector(`[data-row="${key}"]`) : null;
    (row?.querySelector<HTMLElement>(selector) ?? document.getElementById('adm-main'))?.focus();
  });
}

/**
 * A dismissed paper leaves every day it was listed on (the server hides it there too), and focus moves to the next
 * row's Dismiss. Undo puts it back where it was and returns focus to its Dismiss.
 */
async function dismiss(d: Day, i: DigestItem) {
  const was = i.paper.state;
  try {
    await setState(i.paper.id, 'dismissed');
  } catch (e) {
    return report(e);
  }
  // After the await: a double click's first dismiss may have removed it already.
  const at = days.value.map((x) => x.items.findIndex((y) => y.paper.id === i.paper.id));
  if (at.every((n) => n < 0)) return;
  const k = d.items.findIndex((y) => y.paper.id === i.paper.id);
  const next = k < 0 ? undefined : (d.items[k + 1] ?? d.items[k - 1]);
  const removed = days.value.map((x, n) => (at[n] < 0 ? null : x.items.splice(at[n], 1)[0]));
  focusIn(next ? rowKey(d, next) : null, '.adm-reading-dismiss');
  toast('Dismissed', undefined, {
    label: 'Undo',
    run: async () => {
      try {
        await setState(i.paper.id, was);
      } catch (e) {
        return report(e);
      }
      days.value.forEach((x, n) => {
        const item = removed[n];
        if (item) x.items.splice(Math.min(at[n], x.items.length), 0, { ...item, paper: { ...item.paper, state: was } });
      });
      focusIn(rowKey(d, i), '.adm-reading-dismiss');
    },
  });
}

async function poll() {
  try {
    run.value = await api<RunStatus>('reading/run');
  } catch (e) {
    stop();
    return report(e);
  }
  if (!isRunning(run.value.status)) {
    stop();
    await load();
  }
}
function stop() {
  clearInterval(timer);
  timer = undefined;
}
function watch() {
  if (!timer) timer = setInterval(poll, 5000);
}
async function runNow() {
  starting.value = true;
  try {
    const res = await api<{ runId?: string; running?: boolean }>('reading/run', { method: 'POST' });
    if (res.running) toast('A run is already in progress');
    run.value = { ...run.value, status: 'running' };
    watch();
  } catch (e) {
    report(e);
  } finally {
    starting.value = false;
  }
}

onMounted(async () => {
  void load();
  const [s, r] = await Promise.allSettled([
    api<{ prefs: ReadingPrefs }>('reading/settings'),
    api<RunStatus>('reading/run'),
  ]);
  if (s.status === 'fulfilled') prefs.value = s.value.prefs;
  else report(s.reason);
  runKnown.value = true;
  if (r.status === 'fulfilled') {
    run.value = r.value;
    if (isRunning(run.value.status)) watch();
  } else report(r.reason);
});
onBeforeUnmount(stop);
</script>

<template>
  <AdminShell :ctx="ctx" active="reading" title="Reading">
    <ReadingNav :base="base" current="today" />

    <div class="rd-stats">
      <StatCard
        icon="pi-sun"
        tint="warning"
        label="Today’s digest"
        :value="tile(newest?.items.length ?? (loading ? undefined : 0))"
        :against="newest ? formatDate(newest.day) : undefined"
      />
      <StatCard
        icon="pi-comments"
        tint="pink"
        label="People are talking about"
        :value="tile(newest ? inSection(newest, 'talked').length : loading ? undefined : 0)"
        :against="prefs ? `up to ${prefs.talked}` : undefined"
      />
      <StatCard
        icon="pi-star"
        tint="primary"
        label="New in your field"
        :value="tile(newest ? inSection(newest, 'field').length : loading ? undefined : 0)"
        :against="prefs ? `up to ${prefs.inField}` : undefined"
      />
      <StatCard
        icon="pi-bookmark"
        tint="success"
        label="Saved"
        :value="tile(savedCount)"
        against="Library"
        :href="`${base}/reading/library`"
      />
    </div>

    <section class="card rd-run" :class="{ 'is-attention': run.status === 'failed' }" aria-label="Nightly run">
      <div v-if="!runKnown" class="rd-run-strip" aria-hidden="true">
        <Skeleton shape="circle" size="2.75rem" />
        <Skeleton height="1.25rem" class="rd-run-skel" />
      </div>
      <div v-else class="rd-run-strip">
        <span
          :class="['stat-icon', run.status === 'failed' ? 'tint-danger' : running ? 'tint-info' : 'tint-primary']"
          aria-hidden="true"
          ><i :class="['pi', run.status === 'failed' ? 'pi-exclamation-triangle' : 'pi-history']"
        /></span>
        <div class="rd-run-text">
          <p role="status">
            <template v-if="run.status === 'failed'">The last run failed. </template>
            <template v-if="run.lastRun">
              {{ run.status === 'failed' ? 'Last finished run' : 'Last run' }} {{ relativeTime(run.lastRun.at) }} ·
              {{ readingRunLine(run.lastRun) }}
            </template>
            <template v-else-if="run.status !== 'failed'">No run yet. The digest runs every night.</template>
          </p>
        </div>
        <Button
          icon="pi pi-play"
          :label="running ? 'Running…' : 'Run now'"
          :loading="running"
          :disabled="running"
          @click="runNow"
        />
      </div>
      <template v-if="run.lastRun">
        <div v-if="readingRunNotes(run.lastRun).length" class="rd-run-notes" role="status">
          <p v-for="note in readingRunNotes(run.lastRun)" :key="note">
            <i class="pi pi-exclamation-circle" aria-hidden="true" /> {{ note }}
          </p>
        </div>
        <details v-if="run.lastRun.sources.length" class="rd-sources" :open="run.lastRun.sources.some((s) => s.error)">
          <summary>
            <i class="pi pi-angle-right" aria-hidden="true" /> By source ({{ run.lastRun.sources.length }})
          </summary>
          <ul>
            <li v-for="s in run.lastRun.sources" :key="s.id">
              <span :class="['chip', `chip-${s.error ? 'danger' : 'secondary'}`]">{{
                SOURCE_NAMES[s.id] ?? s.id
              }}</span>
              <span class="rd-sources-main">
                found {{ s.found }} · added {{ s.added }}
                <span v-if="s.skipped" class="rd-sources-detail">Skipped: {{ visible(s.skipped) }}</span>
                <span v-if="s.error" class="rd-sources-detail is-error">{{ visible(s.error) }}</span>
              </span>
            </li>
          </ul>
        </details>
      </template>
    </section>

    <div v-if="loading" class="rd-digest">
      <p class="adm-visually-hidden">Loading…</p>
      <div class="card"><Skeleton v-for="n in 4" :key="n" height="3.5rem" class="mb-3" /></div>
    </div>
    <section v-else-if="!newest" class="card empty-state rd-empty">
      <i class="pi pi-inbox" aria-hidden="true" />
      <p>
        No digest yet. Choose your field and sources in <a :href="`${base}/reading/settings`">Settings</a>; the digest
        arrives every morning.
      </p>
    </section>
    <div v-else class="rd-digest" :class="{ 'has-side': earlier.length || more }">
      <div class="rd-sections">
        <template v-for="[s, head] in SECTIONS" :key="s">
          <section
            v-if="inSection(newest, s).length || thin(s)"
            class="card card-flush rd-section"
            :aria-labelledby="`rd-head-${s}`"
          >
            <div class="card-head">
              <div class="rd-head">
                <span :class="['rd-head-icon', `tint-${SECTION_LOOK[s].tint}`]" aria-hidden="true"
                  ><i :class="['pi', SECTION_LOOK[s].icon]"
                /></span>
                <h2 :id="`rd-head-${s}`" class="card-title">{{ head }}</h2>
              </div>
              <span v-if="inSection(newest, s).length" class="chip chip-secondary">{{
                inSection(newest, s).length
              }}</span>
            </div>
            <ul v-if="inSection(newest, s).length" class="rd-rows">
              <DigestRow
                v-for="i in inSection(newest, s)"
                :key="i.paper.id"
                :item="i"
                :row-key="rowKey(newest, i)"
                :rank="s === 'unranked' ? undefined : i.rank"
                :href="`${base}/reading/papers/${i.paper.id}`"
                @save="toggleSave(i)"
                @dismiss="dismiss(newest, i)"
              />
            </ul>
            <p v-if="thin(s)" class="rd-thin"><i class="pi pi-info-circle" aria-hidden="true" /> {{ thin(s) }}</p>
          </section>
        </template>
      </div>

      <section v-if="earlier.length || more" class="card card-flush rd-earlier" aria-labelledby="rd-head-earlier">
        <div class="card-head">
          <div class="rd-head">
            <span class="rd-head-icon tint-info" aria-hidden="true"><i class="pi pi-calendar" /></span>
            <h2 id="rd-head-earlier" class="card-title">Earlier days</h2>
          </div>
        </div>
        <div class="rd-timeline">
          <details v-for="d in earlier" :key="d.day" class="rd-day">
            <summary>
              <span class="rd-day-dot" aria-hidden="true" />
              <span class="rd-day-label">{{ dayLine(d.day, d.items.length) }}</span>
              <i class="pi pi-angle-down rd-day-toggle" aria-hidden="true" />
            </summary>
            <ul class="rd-rows">
              <DigestRow
                v-for="i in d.items"
                :key="i.paper.id"
                :item="i"
                :row-key="rowKey(d, i)"
                :href="`${base}/reading/papers/${i.paper.id}`"
                @save="toggleSave(i)"
                @dismiss="dismiss(d, i)"
              />
            </ul>
          </details>
        </div>
        <div v-if="more" class="rd-more">
          <Button
            :label="loadingMore ? 'Loading…' : 'Show earlier'"
            icon="pi pi-history"
            severity="secondary"
            outlined
            size="small"
            :disabled="loadingMore"
            @click="showEarlier"
          />
        </div>
      </section>
    </div>
  </AdminShell>
</template>

<style scoped>
.rd-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-block-end: 1rem;
}
@media (max-width: 767.98px) {
  .rd-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }
  .rd-stats > :deep(.stat-card) {
    padding: 1rem;
  }
}
.rd-run {
  margin-block-end: 1rem;
  padding-block: 1rem;
}
.rd-run.is-attention {
  box-shadow:
    inset 4px 0 0 var(--c-danger),
    var(--app-shadow-card);
}
.rd-run-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
}
.rd-run-strip .stat-icon {
  flex: none;
  width: 2.75rem;
  height: 2.75rem;
  margin: 0;
  font-size: 1.05rem;
}
.rd-run-skel {
  flex: 1;
  max-width: 28rem;
}
.rd-run-text {
  flex: 1 1 18rem;
  min-width: 0;
}
.rd-run-text p {
  margin: 0;
  color: var(--app-heading);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.rd-run-notes {
  display: grid;
  gap: 0.25rem;
  margin-block-start: 0.875rem;
  padding: 0.625rem 0.875rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--c-danger) 7%, transparent);
}
.rd-run-notes p {
  margin: 0;
  color: var(--c-danger);
  font-size: 0.875rem;
}
.rd-sources {
  margin-block-start: 0.875rem;
  padding-block-start: 0.75rem;
  border-top: 1px dashed var(--app-border);
}
.rd-sources summary {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2.25rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  list-style: none;
}
.rd-sources summary::-webkit-details-marker {
  display: none;
}
.rd-sources summary .pi {
  font-size: 0.75rem;
  transition: transform 0.15s;
}
.rd-sources[open] summary .pi {
  transform: rotate(90deg);
}
.rd-sources summary:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
  border-radius: 0.25rem;
}
.rd-sources ul {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.5rem;
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
}
.rd-sources li {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--app-border);
  border-radius: 0.5rem;
  font-size: 0.8125rem;
}
.rd-sources-main {
  color: var(--app-body);
  font-variant-numeric: tabular-nums;
}
.rd-sources-detail {
  display: block;
  color: var(--app-muted);
}
.rd-sources-detail.is-error {
  color: var(--c-danger);
}

.rd-digest {
  display: grid;
  gap: 1rem;
  align-items: start;
}
@media (min-width: 1200px) {
  .rd-digest.has-side {
    grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
  }
}
.rd-sections {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.rd-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.rd-head-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.5rem;
  font-size: 1rem;
}
.rd-rows {
  margin: 0;
  padding: 0;
  list-style: none;
  container-type: inline-size;
}
.rd-thin {
  display: flex;
  gap: 0.5rem;
  margin: 0;
  padding: 0.875rem 1.5rem;
  border-top: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-canvas) 60%, transparent);
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-thin .pi {
  margin-block-start: 0.2rem;
  font-size: 0.8125rem;
}
.rd-empty p {
  max-width: 34rem;
  margin: 0;
}

/* Earlier days: a timeline of collapsible days (Conca's timeline card). */
.rd-timeline {
  padding: 0.75rem 0;
}
.rd-day > summary {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 2.75rem;
  padding: 0.375rem 1.5rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}
.rd-day > summary::-webkit-details-marker {
  display: none;
}
.rd-day > summary:hover {
  background: var(--app-menu-hover);
}
.rd-day > summary:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
}
.rd-day > summary::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: calc(1.5rem + 0.3125rem);
  border-inline-start: 1px dashed var(--app-border);
}
.rd-day:first-child > summary::before {
  inset-block-start: 50%;
}
.rd-day:last-child:not([open]) > summary::before {
  inset-block-end: 50%;
}
.rd-day-dot {
  position: relative;
  z-index: 1;
  flex: none;
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid var(--app-card);
  border-radius: 50%;
  background: var(--c-primary);
  box-shadow: 0 0 0 1px var(--c-primary);
}
.rd-day:nth-child(3n + 2) .rd-day-dot {
  background: var(--c-warning);
  box-shadow: 0 0 0 1px var(--c-warning);
}
.rd-day:nth-child(3n + 3) .rd-day-dot {
  background: var(--c-success);
  box-shadow: 0 0 0 1px var(--c-success);
}
.rd-day-label {
  flex: 1;
}
.rd-day-toggle {
  color: var(--app-muted);
  font-size: 0.75rem;
  transition: transform 0.15s;
}
.rd-day[open] .rd-day-toggle {
  transform: rotate(180deg);
}
.rd-day[open] > .rd-rows {
  margin: 0.25rem 1rem 0.75rem calc(1.5rem + 0.75rem);
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
}
.rd-more {
  display: flex;
  justify-content: center;
  padding: 0 1.5rem 1.25rem;
}
</style>
