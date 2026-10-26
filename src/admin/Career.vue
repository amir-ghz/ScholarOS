<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import Skeleton from 'primevue/skeleton';
import AdminTabLinks from './AdminTabLinks.vue';
import AdminShell from './AdminShell.vue';
import StatCard from './ui/StatCard.vue';
import { STATUS_TINT, scoreTint } from './ui/career/tint';
import { api, report, session, toast } from './api';
import { formatDateTime, relativeTime } from './dates';
import { vDialog } from './dialog';
import { READY_STATE, runLine, runNotes, visible, isRunning, type ReadyRow, type RunStatus } from './career';
import type { AdminCtx } from './types';
import type { CareerPrefs } from '../lib/career/settings';
import type { Feed, PostingSummary } from '../lib/career/types';

// Every string from a posting or a source error is third-party text: shown with {{ }} only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
// The common statuses are filter tabs; the rest sit in a small select. `open` is every status not closed.
const TABS = [
  ['open', 'Open'],
  ['drafted', 'Drafted'],
  ['ready', 'Ready for approval'],
  ['submitted', 'Submitted'],
] as const;
const OTHER = [
  ['skipped', 'Skipped'],
  ['interview', 'Interview'],
  ['offer', 'Offer'],
  ['rejected', 'Rejected'],
  ['no-response', 'No response'],
  ['withdrawn', 'Withdrawn'],
  ['all', 'All'],
] as const;
const KNOWN = new Set<string>([...TABS, ...OTHER].map(([s]) => s));
/** The other-status select's options; its empty first one stands for "none of these" (the select's label). */
const OTHER_OPTIONS = [{ value: '', label: 'Other status' }, ...OTHER.map(([value, label]) => ({ value, label }))];
const fromUrl = () => {
  const s = new URLSearchParams(location.search).get('status') ?? '';
  return KNOWN.has(s) ? s : 'open';
};

const empty = { rows: [], total: 0 };
const groups = ref<Feed>({ matches: empty, below: empty, gated: empty, unscored: empty });
const threshold = ref(70);
const filter = ref(fromUrl());
const run = ref<RunStatus>({ runId: null, status: null, lastRun: null });
const loading = ref(true);
const starting = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

const running = computed(() => starting.value || isRunning(run.value.status));

const readyRows = ref<ReadyRow[]>([]);
async function loadRows() {
  const status = filter.value;
  try {
    if (status === 'ready') {
      const { rows } = await api<{ rows: ReadyRow[] }>('career/ready');
      if (status !== filter.value) return; // a later filter's answer wins
      readyRows.value = rows;
      session.careerReady = rows.filter((r) => r.state === 'ready').length;
      return;
    }
    const feed = await api<Feed>(`career/postings${status === 'all' ? '' : `?status=${status}`}`);
    if (status !== filter.value) return;
    groups.value = feed;
  } catch (e) {
    report(e);
  } finally {
    loading.value = false;
  }
}

/** The ready postings that are waiting for approval, the ones Approve all ready approves. */
function waiting() {
  return readyRows.value.filter((r) => r.state === 'ready');
}
const confirmAll = ref(false);
const approving = ref(false);
/** Approves exactly the rows the dialog listed, each by the pre-fill it showed: one re-filled since is left alone. */
async function approveAll() {
  confirmAll.value = false;
  approving.value = true;
  const items = waiting().map((r) => ({ id: r.id, at: r.prefilledAt }));
  try {
    const { approved, skipped, queued } = await api<{
      approved: number[];
      skipped: { id: number; reason: string }[];
      queued: boolean;
    }>('career/approve-all', { body: { items } });
    const sent = !approved.length
      ? 'Nothing was approved'
      : queued
        ? `Approved ${approved.length}: each is submitted in the next few minutes`
        : `Approved ${approved.length}: submitted when the queue next runs (at the latest with tonight’s run)`;
    const again = skipped.filter((s) => s.reason === 'pre-filled again').length;
    const gone = skipped.length - again;
    const left = [again && `${again} pre-filled again since you looked`, gone && `${gone} no longer waiting`]
      .filter(Boolean)
      .join(', ');
    toast(left ? `${sent}. ${left}: left as they were.` : `${sent}.`);
  } catch (e) {
    report(e);
  } finally {
    approving.value = false;
    await loadRows();
  }
}

/** A history entry per filter, so Back and reload come back to it. */
function setFilter(status: string) {
  if (status === filter.value) return;
  filter.value = status;
  history.pushState(null, '', status === 'open' ? location.pathname : `?status=${status}`);
  void loadRows();
}
function onPop() {
  filter.value = fromUrl();
  void loadRows();
}

async function poll() {
  try {
    run.value = await api<RunStatus>('career/run');
  } catch (e) {
    stop();
    return report(e);
  }
  if (!isRunning(run.value.status)) {
    stop();
    await loadRows();
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
    const res = await api<{ runId?: string; running?: boolean }>('career/run', { method: 'POST' });
    if (res.running) toast('A run is already in progress');
    run.value = { ...run.value, status: 'running' };
    watch();
  } catch (e) {
    report(e);
  } finally {
    starting.value = false;
  }
}

const where = (r: PostingSummary) => [r.location, r.remote ? 'remote' : ''].filter(Boolean).join(' · ');

// The run status is unknown until `career/run` answers; until then the strip shows a placeholder, not "No run yet".
const runKnown = ref(false);
onMounted(async () => {
  addEventListener('popstate', onPop);
  void loadRows();
  const [s, r] = await Promise.allSettled([
    api<{ prefs: CareerPrefs }>('career/settings'),
    api<RunStatus>('career/run'),
  ]);
  if (s.status === 'fulfilled') threshold.value = s.value.prefs.threshold;
  else report(s.reason);
  runKnown.value = true; // on a failure too: "No run yet" and Run now, rather than a placeholder forever
  if (r.status === 'fulfilled') {
    run.value = r.value;
    if (isRunning(run.value.status)) watch();
  } else report(r.reason);
});
onBeforeUnmount(() => {
  stop();
  removeEventListener('popstate', onPop);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="career" title="Job search">
    <AdminTabLinks
      class="career-tabs"
      label="Job search"
      :tabs="[
        { href: `${base}/career`, label: 'Postings', current: filter !== 'ready' },
        {
          href: `${base}/career?status=ready`,
          label: 'Ready for approval',
          current: filter === 'ready',
          count: session.careerReady ?? undefined,
        },
        { href: `${base}/career/settings`, label: 'Settings' },
      ]"
    />

    <div class="career-stats">
      <StatCard
        icon="pi-inbox"
        tint="warning"
        label="Ready for approval"
        :value="session.careerReady === null ? '–' : String(session.careerReady)"
        :href="`${base}/career?status=ready`"
      />
      <StatCard
        icon="pi-star"
        tint="success"
        label="Matches"
        :value="loading || filter === 'ready' ? '–' : String(groups.matches.total)"
        :against="`${threshold} and above`"
      />
      <StatCard
        icon="pi-search"
        tint="primary"
        label="Found"
        :value="run.lastRun ? String(run.lastRun.sources.reduce((n, s) => n + s.found, 0)) : '–'"
        :against="run.lastRun ? `Last run ${relativeTime(run.lastRun.at)}` : 'No run yet'"
      />
      <StatCard
        icon="pi-chart-bar"
        tint="info"
        label="Scored"
        :value="run.lastRun ? String(run.lastRun.scored) : '–'"
        :against="run.lastRun ? `${run.lastRun.drafted ?? 0} drafted` : undefined"
      />
    </div>

    <div v-if="!runKnown" class="card career-run" aria-hidden="true">
      <Skeleton shape="circle" size="2.75rem" />
      <Skeleton height="1.25rem" class="flex-1" />
    </div>
    <section v-else class="card career-run-card" :class="{ 'is-attention': run.status === 'failed' }">
      <div class="career-run">
        <span
          :class="[
            'stat-icon',
            run.status === 'failed'
              ? 'tint-danger'
              : running
                ? 'tint-info'
                : run.lastRun
                  ? 'tint-success'
                  : 'tint-primary',
          ]"
          aria-hidden="true"
          ><i
            :class="[
              'pi',
              run.status === 'failed' ? 'pi-exclamation-triangle' : running ? 'pi-sync' : 'pi-calendar-clock',
            ]"
        /></span>
        <p role="status" class="career-run-line">
          <template v-if="run.status === 'failed'">The last run failed. </template>
          <template v-if="run.lastRun">
            {{ run.status === 'failed' ? 'Last finished run' : 'Last run' }} {{ relativeTime(run.lastRun.at) }} ·
            {{ runLine(run.lastRun) }}
          </template>
          <template v-else-if="run.status !== 'failed'">No run yet. The search runs every night.</template>
        </p>
        <Button
          icon="pi pi-play"
          :label="running ? 'Running…' : 'Run now'"
          :loading="running"
          :disabled="running"
          @click="runNow"
        />
      </div>
      <template v-if="run.lastRun">
        <div v-if="runNotes(run.lastRun).length" class="career-notes" role="status">
          <p v-for="note in runNotes(run.lastRun)" :key="note" class="adm-err">
            <i class="pi pi-exclamation-circle" aria-hidden="true" /> {{ note }}
          </p>
        </div>
        <details
          v-if="run.lastRun.sources.length"
          class="career-sources"
          :open="run.lastRun.sources.some((s) => s.error)"
        >
          <summary>
            <i class="pi pi-angle-right" aria-hidden="true" /> By source ({{ run.lastRun.sources.length }})
          </summary>
          <ul>
            <li v-for="s in run.lastRun.sources" :key="s.id" class="list-row">
              <span class="career-source-id">{{ s.id }}</span>
              <span class="career-source-main">
                <span class="chip chip-secondary">found {{ s.found }} · added {{ s.added }}</span>
                <span v-if="s.skipped" class="list-row-sub">Skipped: {{ visible(s.skipped) }}</span>
                <span v-if="s.error" class="adm-err">{{ visible(s.error) }}</span>
              </span>
            </li>
          </ul>
        </details>
      </template>
    </section>

    <section class="card card-flush career-list">
      <div class="card-head career-filters">
        <div class="career-filter" role="group" aria-label="Status">
          <button v-for="[s, label] in TABS" :key="s" type="button" :aria-pressed="filter === s" @click="setFilter(s)">
            {{ label }}
          </button>
        </div>
        <Select
          :model-value="OTHER.some(([s]) => s === filter) ? filter : ''"
          :options="OTHER_OPTIONS"
          option-label="label"
          option-value="value"
          placeholder="Other status"
          size="small"
          aria-label="Other status"
          class="career-other"
          @update:model-value="(v: string | null) => setFilter(v || 'open')"
        />
      </div>

      <div v-if="loading" class="career-body">
        <p class="adm-visually-hidden">Loading…</p>
        <Skeleton v-for="n in 4" :key="n" height="3rem" class="mb-3" />
      </div>
      <div v-else-if="filter === 'ready'" class="career-body">
        <div class="career-ready-head">
          <p>
            <i class="pi pi-shield" aria-hidden="true" />
            Nothing is sent until you approve. Approving submits an application with the values on its page, usually
            within a few minutes.
          </p>
          <Button
            icon="pi pi-check"
            :label="approving ? 'Approving…' : 'Approve all ready'"
            :loading="approving"
            :disabled="!waiting().length || approving"
            @click="confirmAll = true"
          />
        </div>
        <div v-if="!readyRows.length" class="empty-state">
          <i class="pi pi-inbox" aria-hidden="true" />
          <p>
            Nothing is waiting for approval. A pre-filled application shows here until you approve, skip or finish it.
          </p>
        </div>
        <ul v-else class="career-rows">
          <li v-for="r in readyRows" :key="r.id" class="career-row">
            <strong
              :class="['career-score', `tint-${scoreTint(r.score, threshold)}`]"
              :aria-label="r.score === null ? 'Not scored' : `Score ${r.score}`"
              >{{ r.score ?? '–' }}</strong
            >
            <span class="career-main">
              <span class="career-title">{{ r.title }}</span>
              <span class="career-meta"
                ><i class="pi pi-building" aria-hidden="true" /> {{ r.company
                }}<template v-if="r.fields"> · {{ r.fields }} fields</template></span
              >
            </span>
            <span class="career-tags">
              <span v-if="r.state !== 'ready'" class="chip chip-warning">{{ READY_STATE[r.state ?? 'none'] }}</span>
              <span v-else class="chip chip-success">Ready</span>
            </span>
            <span class="career-date"
              ><template v-if="r.prefilledAt"
                >Pre-filled <time :datetime="r.prefilledAt">{{ formatDateTime(r.prefilledAt) }}</time></template
              ></span
            >
            <span class="career-action">
              <Button
                as="a"
                :href="`${base}/career/${r.id}#job-apply`"
                :aria-label="`Review ${r.title} at ${r.company}`"
                label="Review"
                icon="pi pi-arrow-right"
                icon-pos="right"
                size="small"
                severity="secondary"
                outlined
              />
            </span>
          </li>
        </ul>
      </div>
      <template v-else>
        <div class="career-group-head">
          <h2 class="card-title">
            Matches <span class="chip chip-success">{{ groups.matches.total }}</span>
          </h2>
          <span class="card-subtitle">Score {{ threshold }} and above</span>
        </div>
        <div v-if="!groups.matches.total" class="empty-state">
          <i class="pi pi-star" aria-hidden="true" />
          <p>Nothing at or above {{ threshold }} yet.</p>
        </div>
        <ul v-else class="career-rows">
          <li v-for="r in groups.matches.rows" :key="r.id" class="career-row">
            <strong
              :class="['career-score', `tint-${scoreTint(r.score, threshold)}`]"
              :aria-label="`Score ${r.score}`"
              >{{ r.score }}</strong
            >
            <span class="career-main">
              <a class="career-title" :href="`${base}/career/${r.id}`">{{ r.title }}</a>
              <span class="career-meta"
                ><i class="pi pi-building" aria-hidden="true" /> {{ r.company
                }}<template v-if="where(r)"> · {{ where(r) }}</template></span
              >
            </span>
            <span class="career-tags">
              <span
                v-if="r.flagged"
                class="chip chip-danger"
                title="The ad contained hidden or instruction-like text"
                aria-label="Flagged"
                >⚠</span
              >
              <span :class="['chip', `chip-${STATUS_TINT[r.status]}`]">{{ r.status }}</span>
            </span>
          </li>
        </ul>
        <p v-if="groups.matches.total > groups.matches.rows.length" class="career-more">
          Showing the best {{ groups.matches.rows.length }}.
        </p>

        <details
          v-for="[label, list, gate] in [
            ['Below threshold', groups.below, false],
            ['Filtered out', groups.gated, true],
            ['Not scored yet', groups.unscored, false],
          ] as const"
          :key="label"
          class="career-group"
        >
          <summary>
            <i class="pi pi-angle-right" aria-hidden="true" /> {{ label }}
            <span class="chip chip-secondary">{{ list.total }}</span>
          </summary>
          <ul class="career-rows">
            <li v-for="r in list.rows" :key="r.id" class="career-row">
              <strong v-if="r.score !== null" :class="['career-score', `tint-${scoreTint(r.score, threshold)}`]">{{
                r.score
              }}</strong>
              <span v-else class="career-score tint-secondary" aria-hidden="true">–</span>
              <span class="career-main">
                <a class="career-title" :href="`${base}/career/${r.id}`">{{ r.title }}</a>
                <span class="career-meta">
                  <i class="pi pi-building" aria-hidden="true" /> {{ r.company
                  }}<template v-if="where(r)"> · {{ where(r) }}</template>
                  <template v-if="gate && r.gate"> · {{ visible(r.gate) }}</template>
                </span>
              </span>
              <span class="career-tags">
                <span
                  v-if="r.flagged"
                  class="chip chip-danger"
                  title="The ad contained hidden or instruction-like text"
                  aria-label="Flagged"
                  >⚠</span
                >
                <span :class="['chip', `chip-${STATUS_TINT[r.status]}`]">{{ r.status }}</span>
              </span>
            </li>
          </ul>
          <p v-if="list.total > list.rows.length" class="career-more">Showing the first {{ list.rows.length }}.</p>
        </details>
      </template>
    </section>

    <div
      v-if="confirmAll"
      v-dialog
      class="career-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adm-approve-all"
      @keydown.esc="confirmAll = false"
    >
      <div class="career-modal-box">
        <h2 id="adm-approve-all" class="card-title">
          Approve {{ waiting().length === 1 ? 'this application' : `these ${waiting().length} applications` }}?
        </h2>
        <p>
          Each one is approved on its own, with the values it was pre-filled with, and submitted within a few minutes.
          Any form that changed since is stopped and handed back to you.
        </p>
        <ul class="career-modal-list">
          <li v-for="r in waiting()" :key="r.id" class="list-row">
            <span class="min-w-0"
              ><span class="list-row-title">{{ r.title }}</span
              ><span class="list-row-sub">{{ r.company }} · {{ r.fields }} fields</span></span
            >
          </li>
        </ul>
        <div class="career-modal-actions">
          <Button label="Cancel" severity="secondary" outlined data-autofocus @click="confirmAll = false" />
          <Button icon="pi pi-send" label="Approve and submit all" @click="approveAll" />
        </div>
      </div>
    </div>
  </AdminShell>
</template>

<style scoped>
/* Sibling screens: Conca's underlined tab row under the page title. */
.career-tabs.adm-tablinks {
  gap: 0 0.5rem;
  margin-block: -0.75rem 1.5rem;
  border-block-end: 1px solid var(--app-border);
}
.career-tabs.adm-tablinks :deep(a) {
  min-height: 2.75rem;
  padding-inline: 0.875rem;
  color: var(--app-body);
  font-size: 0.9375rem;
  font-weight: 500;
}
.career-tabs.adm-tablinks :deep(a:hover) {
  color: var(--p-primary-color);
}
.career-tabs.adm-tablinks :deep(a[aria-current='page']) {
  border-block-end-color: var(--p-primary-color);
  color: var(--p-primary-color);
}
.career-tabs.adm-tablinks :deep(.adm-count) {
  display: inline-grid;
  place-items: center;
  min-width: 1.375rem;
  height: 1.375rem;
  padding: 0 0.375rem;
  border-radius: 999px;
  background: var(--c-danger);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
}

.career-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-block-end: 1rem;
}

/* The run strip. */
.career-run-card {
  margin-block-end: 1rem;
  padding-block: 1.125rem;
}
.career-run-card.is-attention {
  box-shadow:
    inset 4px 0 0 var(--c-danger),
    var(--app-shadow-card);
}
.career-run {
  display: flex;
  align-items: center;
  gap: 1rem;
}
div.career-run {
  margin-block-end: 1rem;
}
.career-run .stat-icon {
  flex: none;
  width: 2.75rem;
  height: 2.75rem;
  margin: 0;
  font-size: 1.125rem;
}
.career-run-line {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--app-heading);
  font-weight: 500;
}
.career-notes {
  display: grid;
  gap: 0.25rem;
  margin-block-start: 0.875rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--c-danger) 7%, transparent);
}
.career-notes p {
  margin: 0;
  font-size: 0.8125rem;
}
:global(.app-dark) .career-notes p,
:global(.app-dark) .career-source-main .adm-err {
  color: #ff7b72;
}
.career-sources {
  margin-block-start: 0.75rem;
  border-top: 1px solid var(--app-border);
}
.career-sources summary,
.career-group summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-block: 0.75rem 0.25rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 600;
  list-style: none;
  cursor: pointer;
}
.career-sources summary::-webkit-details-marker,
.career-group summary::-webkit-details-marker {
  display: none;
}
.career-sources summary .pi,
.career-group summary .pi {
  color: var(--app-muted);
  font-size: 0.75rem;
  transition: transform 0.15s;
}
.career-sources[open] > summary .pi,
.career-group[open] > summary .pi {
  transform: rotate(90deg);
}
.career-sources ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.career-source-id {
  flex: none;
  min-width: 8rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.career-source-main {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75rem;
  min-width: 0;
}

/* Postings. */
.career-filters {
  padding-block: 0 !important;
  padding-inline-end: 1.25rem !important;
}
.career-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.25rem;
}
.career-filter button {
  min-height: 3.5rem;
  padding: 0 0.875rem;
  border: 0;
  border-block-end: 2px solid transparent;
  margin-block-end: -1px;
  background: none;
  color: var(--app-body);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s;
}
.career-filter button:hover {
  color: var(--p-primary-color);
}
.career-filter button[aria-pressed='true'] {
  border-block-end-color: var(--p-primary-color);
  color: var(--p-primary-color);
}
.career-filter button:focus-visible {
  outline-offset: -2px;
}
.career-other {
  min-width: 11rem;
}
.career-body {
  padding: 1.25rem 1.5rem;
}
.career-ready-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  padding: 0.875rem 1rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--p-primary-color) 6%, transparent);
}
.career-ready-head p {
  flex: 1 1 24rem;
  margin: 0;
  color: var(--app-heading);
  font-size: 0.875rem;
}
.career-ready-head .pi {
  margin-inline-end: 0.25rem;
  color: var(--p-primary-color);
}
.career-body > .career-rows {
  margin-inline: -1.5rem;
  margin-block-end: -1.25rem;
}
.career-group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  padding: 1.25rem 1.5rem 0.5rem;
}
.career-group-head .card-title {
  font-size: 1rem;
}
.empty-state p {
  max-width: 32rem;
  margin: 0;
}
.career-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.career-row {
  display: grid;
  grid-template-columns: 2.75rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem 1rem;
  padding: 0.875rem 1.5rem;
  border-top: 1px solid var(--app-border);
  transition: background 0.15s;
}
.career-row:hover {
  background: color-mix(in srgb, var(--app-menu-hover) 70%, transparent);
}
.career-body .career-row {
  grid-template-columns: 2.75rem minmax(0, 1fr) auto auto auto;
}
.career-score {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.625rem;
  font-size: 0.9375rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.career-main {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
}
.career-title {
  overflow: hidden;
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
a.career-title:hover {
  color: var(--p-primary-color);
  text-decoration: none;
}
.career-meta {
  overflow: hidden;
  color: var(--app-muted);
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.career-meta .pi {
  font-size: 0.75rem;
}
.career-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.375rem;
}
.career-date {
  color: var(--app-muted);
  font-size: 0.8125rem;
  white-space: nowrap;
}
.career-more {
  margin: 0;
  padding: 0.75rem 1.5rem;
  border-top: 1px solid var(--app-border);
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.career-group {
  border-top: 1px solid var(--app-border);
}
.career-group summary {
  padding: 1rem 1.5rem;
}
.career-group summary:hover {
  background: var(--app-menu-hover);
}
.career-group summary:focus-visible {
  outline-offset: -2px;
}

/* Approve all: a modal card. */
.career-modal {
  position: fixed;
  inset: 0;
  z-index: 1101;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(25 24 34 / 0.45);
  backdrop-filter: blur(2px);
}
.career-modal-box {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: min(640px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 1.5rem;
  border-radius: var(--app-radius-card);
  background: var(--app-card);
  box-shadow: var(--app-shadow-float);
}
.career-modal-box p {
  margin: 0;
}
.career-modal-list {
  margin: 0;
  padding: 0 1rem;
  border: 1px solid var(--app-border);
  border-radius: 0.5rem;
  list-style: none;
}
.career-modal-list .list-row-sub {
  display: block;
}
.career-modal-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (max-width: 575.98px) {
  .career-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }
  .career-stats > .stat-card {
    padding: 1rem;
  }
  .career-stats > .stat-card :deep(.stat-icon) {
    width: 2.25rem;
    height: 2.25rem;
    margin-block-end: 0.5rem;
    font-size: 1rem;
  }
  .career-stats > .stat-card :deep(.stat-value) {
    font-size: 1.5rem;
  }
  .career-stats > .stat-card :deep(.stat-trend) {
    white-space: normal;
  }
}
@media (max-width: 767.98px) {
  .career-run {
    flex-wrap: wrap;
  }
  .career-run-line {
    flex-basis: calc(100% - 4rem);
  }
  .career-filters {
    padding-inline: 0.5rem 1rem !important;
  }
  .career-filter {
    flex-wrap: nowrap;
    width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .career-filter button {
    flex: none;
    min-height: 3rem;
    padding-inline: 0.625rem;
  }
  .career-other {
    width: 100%;
    margin-block-end: 0.75rem;
  }
  .career-row,
  .career-body .career-row {
    grid-template-columns: 2.5rem minmax(0, 1fr);
    padding-inline: 1rem;
  }
  .career-score {
    width: 2.5rem;
    height: 2.5rem;
  }
  .career-title,
  .career-meta {
    white-space: normal;
  }
  .career-tags,
  .career-date,
  .career-action {
    grid-column: 2;
    justify-content: flex-start;
  }
  .career-body {
    padding-inline: 1rem;
  }
  .career-body > .career-rows {
    margin-inline: -1rem;
  }
  .career-group-head,
  .career-group summary,
  .career-more {
    padding-inline: 1rem;
  }
  .career-source-id {
    min-width: 0;
  }
  .career-sources .list-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
