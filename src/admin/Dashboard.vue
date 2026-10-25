<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Chart from 'primevue/chart';
import Select from 'primevue/select';
import Skeleton from 'primevue/skeleton';
import AdminShell from './AdminShell.vue';
import StatCard from './ui/StatCard.vue';
import { CHANNELS, RANGE_OPTIONS, againstFor, ringChart, trafficChart, useAnalytics, type Range } from './ui/analytics';
import { change, compact, countryName, flag, usePalette, whole } from './ui/theme';
import { api, committed, toast, toastError } from './api';
import { formatDate, formatDateTime, relativeTime } from './dates';
import {
  nextUp,
  plainFailure,
  siteStatus,
  statusSummary,
  STATUS_CHIP,
  type DashboardData,
  type NewsDraft,
  type RunKind,
  type RunName,
  type StatusRow,
} from './status';
import { storedDrafts } from './useDocument';
import type { AdminCtx } from './types';
import type { JobsRecord } from '../lib/admin/jobs';
import type { PapersResult } from '../lib/admin/papers';

const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const NEXT_UP_LIMIT = 5;
const MARKER = { nudge: 'Suggested', unseen: 'No access', unknown: 'Not run yet', off: 'Off' } as const;
/** What an in-place action changes, read under the row; it follows the button's own label ("Check now imports…"). */
const CHANGES: Partial<Record<RunKind, string>> = {
  'sync-papers': 'imports new papers from Google Scholar and drafts a post for each; your live site updates.',
  'sync-feeds': 'fetches every feed and adds its new posts to the blog; your live site updates.',
};
/** git mode: how often, and how many times, to look for a workflow run started from here (about 10 minutes). */
const WATCH_MS = 15_000;
const WATCH_TRIES = 40;
/** The header button's key in `busy`; rows use their own key. */
const JOBS = 'jobs';
/** Placeholder rows while loading: about as many as a real site has, so the page doesn't jump. */
const SKELETON_ROWS = 7;

const d = ref<DashboardData | null>(null);
const loadError = ref('');
/** The control whose action is running: a row key, or JOBS. One at a time; the others are disabled meanwhile. */
const busy = ref<string | null>(null);
/** Read out after an in-place action refreshes the rows; empty otherwise, so loading the page stays quiet. */
const announcement = ref('');
/** git mode: a row whose workflow was just started on GitHub, and its latest run's time before that. */
const watching = ref<{ key: RunName; before?: string } | null>(null);
let alive = true;
let poll: ReturnType<typeof setTimeout> | undefined;

/** Has the watched row's new run shown up on GitHub yet? */
const isNewRun = (at: string | undefined, before?: string) => !!at && (!before || Date.parse(at) > Date.parse(before));

const rows = computed(() => {
  if (!d.value) return [];
  const all = siteStatus(d.value);
  const w = watching.value;
  if (!w || isNewRun(d.value.runs[w.key]?.at, w.before)) return all;
  // GitHub lists a dispatched run only after a few seconds: until then the row says it is starting, in place.
  return all.map(
    (r): StatusRow =>
      r.key === w.key
        ? {
            ...r,
            state: 'Starting on GitHub…',
            tone: 'ok',
            at: null,
            detail: undefined,
            raw: undefined,
            link: undefined,
          }
        : r,
  );
});
const verdict = computed(() => statusSummary(rows.value));
/** Nothing needs fixing: what to write next leads, and the status follows. */
const newsDrafts = ref<NewsDraft[]>([]);
const upcoming = computed(() => (d.value ? nextUp(d.value.posts, newsDrafts.value) : []));
const names = new Intl.ListFormat('en', { type: 'conjunction' });
/** Front-matter dates are calendar days; job times have a clock time worth showing. */
const absolute = (t: string) => (/^\d{4}-\d{2}-\d{2}$/.test(t) ? formatDate(t) : formatDateTime(t));

function readNewsDrafts() {
  newsDrafts.value = storedDrafts('announcements/').flatMap(({ key, value }) => {
    const data = (value as { data?: Record<string, unknown> } | null)?.data;
    if (!data) return [];
    const slug = key.slice('announcements/'.length);
    return [{ slug: slug === 'new' ? null : slug, data }];
  });
}

async function load() {
  loadError.value = '';
  try {
    d.value = await api<DashboardData>('dashboard');
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
}

/** A failure toast in plain words; the service's own words go to the console, as the rows keep them in a disclosure. */
function toastFailure(raw: string, service: string, unknown = raw) {
  const plain = plainFailure(raw, service);
  // eslint-disable-next-line no-console
  if (plain) console.warn('[dashboard]', raw);
  toastError(plain ?? unknown);
}

async function syncFeeds() {
  const result = await api<{
    changed: boolean;
    count: number;
    failed: { source: string; error: string }[];
    url?: string;
  }>('feeds/sync', { method: 'POST' });
  if (result.changed) committed(result);
  else toast(`No new posts in any feed (${result.count} in total)`);
  for (const f of result.failed) toastFailure(f.error, `The feed “${f.source}”`, `Feed “${f.source}”: ${f.error}`);
}

async function runJobs() {
  const jobs = await api<JobsRecord>('jobs/run', { method: 'POST' });
  const failed = Object.values(jobs).filter((j) => j?.ok === false).length;
  if (failed) toastError(`Daily jobs finished; ${failed} failed. See Site status.`);
  else toast('Daily jobs finished');
}

async function syncPapers() {
  const r = await api<PapersResult>('papers/sync', { method: 'POST' });
  const text = `Google Scholar checked: ${r.imported.length} new publications, ${r.posts.length} draft posts`;
  if (r.skipped) toast(`Nothing checked: ${r.skipped}`);
  // New drafts wait for review, so the notice stays until it is used or dismissed.
  else if (r.posts.length) {
    const label = `Review ${r.posts.length} new draft${r.posts.length === 1 ? '' : 's'}`;
    toast(text, undefined, { label, run: () => location.assign(`${base}/posts`) });
  } else toast(text);
}

async function renderCv() {
  const before = d.value?.runs.cv?.at;
  const r = await api<{ dispatched?: boolean; warning?: 'cache-purge-failed'; tags?: string[] }>('cv/pdf', {
    method: 'POST',
  });
  if (r.warning) committed(r);
  else toast(r.dispatched ? 'PDF build started on GitHub; it takes a few minutes' : 'PDF updated');
  if (r.dispatched) void watchRun('cv', before);
}

/**
 * git mode: after starting a workflow, polls the dashboard until the row's new run has finished, then announces how it
 * went. Gives up quietly after WATCH_TRIES; the row then shows whatever GitHub last said.
 */
async function watchRun(key: RunName, before?: string) {
  watching.value = { key, before };
  for (let i = 0; i < WATCH_TRIES && alive; i++) {
    await new Promise((done) => (poll = setTimeout(done, WATCH_MS)));
    const next = await api<DashboardData>('dashboard').catch(() => null);
    if (!alive || !next) continue;
    const focused = document.activeElement;
    d.value = next;
    await nextTick();
    // A row that changes tone moves; keep focus where it was.
    if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus();
    const run = next.runs[key];
    if (next.hiddenRuns[key]) break;
    if (run && run.ok !== null && isNewRun(run.at, before)) {
      const row = rows.value.find((r) => r.key === key);
      if (row) announcement.value = `${row.label} finished on GitHub: ${row.state}.`;
      break;
    }
  }
  watching.value = null;
}

const RUNNERS: Record<RunKind, [() => Promise<void>, string]> = {
  'sync-feeds': [syncFeeds, 'A feed'],
  'run-jobs': [runJobs, 'The daily jobs'],
  'sync-papers': [syncPapers, 'Google Scholar'],
  'render-cv': [renderCv, 'The PDF builder'],
};

const isRun = (kind: string): kind is RunKind => kind in RUNNERS;

/** After the rows re-sort, focus goes back to the same row: its action, or the row itself when the action is gone. */
function refocus(control: string) {
  if (control === JOBS) return document.getElementById('adm-run-jobs')?.focus();
  const row = document.getElementById(`row-${control}`);
  (row?.querySelector<HTMLElement>('.adm-row-action :is(a, button)') ?? row)?.focus();
}

async function run(kind: RunKind, control: string) {
  // the running (or watched) button stays focusable (aria-disabled), so it guards itself
  if (busy.value || watching.value?.key === control) return;
  const [action, service] = RUNNERS[kind];
  busy.value = control;
  announcement.value = '';
  try {
    await action();
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    toastFailure(raw, service);
  } finally {
    await load(); // last sync, job results and post statuses changed
    busy.value = null;
    await nextTick();
    refocus(control);
    // A run started on GitHub is announced when it finishes (watchRun); the toast already said it started.
    if (d.value && watching.value?.key !== control) announcement.value = `Site status updated: ${verdict.value.text}.`;
  }
}

// Analytics (Postgres mode): the Academy dashboard's charts and lists.
const analyticsOn = props.ctx.mode === 'postgres';
const range = ref<Range>('30d');
const { report, error: analyticsError, load: loadAnalytics } = useAnalytics(range);
const palette = usePalette();
const traffic = computed(() => (report.value ? trafficChart(report.value, palette.value) : null));
const sections = computed(() => report.value?.sections.slice(0, 7) ?? []);
const sectionTotal = computed(() => sections.value.reduce((s, x) => s + x.views, 0));
const ring = computed(() =>
  ringChart(
    sections.value.map((x) => ({ name: x.name, value: x.views })),
    palette.value,
  ),
);
const topCountries = computed(() => report.value?.countries.slice(0, 5) ?? []);
const countryMax = computed(() => Math.max(1, ...topCountries.value.map((c) => c.visitors)));
const published = computed(() => d.value?.posts.filter((p) => !p.data.draft).length ?? 0);
const drafts = computed(() => d.value?.posts.filter((p) => p.data.draft).length ?? 0);

onMounted(() => {
  readNewsDrafts();
  void load();
  if (analyticsOn) void loadAnalytics();
});
onBeforeUnmount(() => {
  alive = false;
  clearTimeout(poll);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="" title="Dashboard">
    <template #actions>
      <Button as="a" :href="`${base}/content/announcements?new`" label="New news item" severity="secondary" outlined />
      <!-- While something is broken, the fix is the page's main action, not a new post. -->
      <Button
        as="a"
        :href="`${base}/posts/new`"
        icon="pi pi-plus"
        label="New blog post"
        :severity="verdict.tone === 'attention' ? 'secondary' : undefined"
        :outlined="verdict.tone === 'attention'"
      />
    </template>

    <p class="adm-visually-hidden" role="status">{{ announcement }}</p>

    <div v-if="d && !loadError" class="card dash-verdict" :class="`is-${verdict.tone}`">
      <span
        :class="[
          'stat-icon',
          verdict.tone === 'attention' ? 'tint-danger' : verdict.tone === 'ok' ? 'tint-success' : 'tint-warning',
        ]"
        aria-hidden="true"
      >
        <i
          :class="[
            'pi',
            verdict.tone === 'attention'
              ? 'pi-exclamation-triangle'
              : verdict.tone === 'ok'
                ? 'pi-check-circle'
                : 'pi-info-circle',
          ]"
        />
      </span>
      <p>
        <a v-if="verdict.key" :href="`#row-${verdict.key}`">{{ verdict.lead }}</a>
        <template v-else>{{ verdict.lead }}</template>
        <template v-if="verdict.suggestions">
          · <a :href="`#row-${verdict.suggestions.key}`">{{ verdict.suggestions.text }}</a>
        </template>
      </p>
    </div>

    <div v-if="loadError" class="adm-banner adm-banner-error" role="alert">
      <span
        >The dashboard could not load ({{ loadError }}). The rest of the admin still works: pick a screen from the
        menu.</span
      >
      <Button label="Retry" size="small" severity="secondary" @click="load" />
    </div>

    <!-- Row 1: stat tiles -->
    <div class="dash-grid dash-stats">
      <template v-if="analyticsOn">
        <StatCard
          icon="pi-users"
          tint="primary"
          label="Visitors"
          :value="report ? compact.format(report.totals.visitors) : '–'"
          :delta="report ? change(report.totals.visitors, report.previous.visitors) : undefined"
          :against="againstFor(range)"
          :href="`${base}/analytics`"
        />
        <StatCard
          icon="pi-eye"
          tint="warning"
          label="Page views"
          :value="report ? compact.format(report.totals.views) : '–'"
          :delta="report ? change(report.totals.views, report.previous.views) : undefined"
          :against="againstFor(range)"
          :href="`${base}/analytics`"
        />
      </template>
      <StatCard
        icon="pi-book"
        tint="success"
        label="Publications"
        :value="d ? whole.format(d.publications) : '–'"
        against="on the site"
        :href="`${base}/publications`"
      />
      <StatCard
        icon="pi-pencil"
        tint="info"
        label="Blog posts"
        :value="d ? whole.format(published) : '–'"
        :against="`${drafts} draft${drafts === 1 ? '' : 's'}`"
        :href="`${base}/posts`"
      />
      <template v-if="!analyticsOn">
        <StatCard
          icon="pi-megaphone"
          tint="warning"
          label="News items"
          :value="d ? whole.format(d.news.count) : '–'"
          :href="`${base}/content/announcements`"
        />
        <StatCard
          icon="pi-users"
          tint="pink"
          label="People"
          :value="d ? whole.format(d.people.count) : '–'"
          :href="`${base}/content/people`"
        />
      </template>
    </div>

    <!-- Row 2: traffic over time and views by section -->
    <div v-if="analyticsOn" class="dash-grid dash-charts">
      <section class="card" aria-labelledby="dash-traffic">
        <div class="card-head">
          <div>
            <h2 id="dash-traffic" class="card-title">Visitors overview</h2>
            <p class="card-subtitle">
              <template v-if="report">
                <i class="pi pi-circle-fill dash-live-dot" aria-hidden="true" /> {{ report.live }} on the site now
              </template>
              <template v-else>Visitors and page views by day</template>
            </p>
          </div>
          <Select
            v-model="range"
            :options="RANGE_OPTIONS"
            option-label="label"
            option-value="value"
            size="small"
            aria-label="Period"
          />
        </div>
        <p v-if="analyticsError" class="adm-error">Analytics could not load: {{ analyticsError }}</p>
        <Skeleton v-else-if="!report" height="300px" />
        <Chart v-else type="line" :data="traffic!.data" :options="traffic!.options" class="dash-chart" />
      </section>

      <section class="card" aria-labelledby="dash-sections">
        <div class="card-head">
          <h2 id="dash-sections" class="card-title">Views by section</h2>
          <a class="dash-link" :href="`${base}/analytics`"
            >Details <i class="pi pi-angle-right" aria-hidden="true"
          /></a>
        </div>
        <Skeleton v-if="!report" shape="circle" size="220px" class="mx-auto" />
        <template v-else-if="sections.length">
          <div class="dash-ring">
            <Chart type="doughnut" :data="ring.data" :options="ring.options" />
            <div class="dash-ring-total">
              <span>Page views</span>
              <strong>{{ compact.format(sectionTotal) }}</strong>
            </div>
          </div>
          <ul class="dash-legend">
            <li v-for="(s, i) in sections" :key="s.name">
              <span class="dash-swatch" :style="{ background: palette.series[i % palette.series.length] }" />
              {{ s.name }}
              <span>{{ Math.round((s.views / sectionTotal) * 100) }}%</span>
            </li>
          </ul>
        </template>
        <div v-else class="empty-state">
          <i class="pi pi-chart-pie" aria-hidden="true" />
          No visits recorded in this period yet.
        </div>
      </section>
    </div>
    <section v-else class="card dash-off">
      <span class="stat-icon tint-primary" aria-hidden="true"><i class="pi pi-chart-line" /></span>
      <div>
        <h2 class="card-title">Visitor analytics</h2>
        <p class="card-subtitle">
          Who visits, from where and which pages: built in for sites with a database (Postgres mode on Vercel, or
          <code>pnpm dev</code>). This site can use Google Analytics or another service from Settings instead.
        </p>
      </div>
    </section>

    <!-- Row 3: three lists -->
    <div class="dash-grid dash-lists">
      <section v-if="analyticsOn" class="card" aria-labelledby="dash-pages">
        <div class="card-head">
          <h2 id="dash-pages" class="card-title">Top pages</h2>
          <Button as="a" :href="`${base}/analytics`" label="View all" size="small" severity="primary" text />
        </div>
        <template v-if="report?.pages.length">
          <div v-for="(pg, i) in report.pages.slice(0, 5)" :key="pg.path" class="list-row">
            <div class="flex min-w-0 items-center gap-3">
              <span :class="['dash-rank', i === 0 ? 'tint-primary' : 'tint-secondary']">{{ i + 1 }}</span>
              <div class="min-w-0">
                <p class="list-row-title" dir="auto">{{ pg.title }}</p>
                <span class="list-row-sub">{{ pg.path }}</span>
              </div>
            </div>
            <span class="chip chip-primary">{{ whole.format(pg.views) }} views</span>
          </div>
        </template>
        <Skeleton v-else-if="!report" height="12rem" />
        <div v-else class="empty-state"><i class="pi pi-file" aria-hidden="true" /> No page views yet.</div>
      </section>

      <section v-if="analyticsOn" class="card" aria-labelledby="dash-where">
        <div class="card-head">
          <h2 id="dash-where" class="card-title">Where visitors come from</h2>
          <Button as="a" :href="`${base}/analytics`" label="Map" size="small" text />
        </div>
        <template v-if="topCountries.length">
          <div v-for="c in topCountries" :key="c.name" class="dash-country">
            <div class="flex items-center justify-between gap-3">
              <span class="flex items-center gap-2">
                <span class="dash-flag" aria-hidden="true">{{ flag(c.name) }}</span>
                <span class="list-row-title">{{ countryName(c.name) }}</span>
              </span>
              <span class="list-row-sub">{{ whole.format(c.visitors) }} visitors</span>
            </div>
            <div class="progress">
              <span :style="{ width: `${(c.visitors / countryMax) * 100}%`, background: 'var(--c-primary)' }" />
            </div>
          </div>
          <p v-if="report && report.channels.length" class="dash-channels">
            <span v-for="ch in report.channels.slice(0, 3)" :key="ch.name" class="chip chip-secondary">
              <i :class="['pi', CHANNELS[ch.name]?.icon ?? 'pi-link']" aria-hidden="true" />
              {{ CHANNELS[ch.name]?.label ?? ch.name }} · {{ whole.format(ch.visitors) }}
            </span>
          </p>
        </template>
        <Skeleton v-else-if="!report" height="12rem" />
        <div v-else class="empty-state"><i class="pi pi-globe" aria-hidden="true" /> No visitors yet.</div>
      </section>

      <section class="card" aria-labelledby="adm-next">
        <div class="card-head">
          <h2 id="adm-next" class="card-title">Next up</h2>
          <Button as="a" :href="`${base}/posts`" label="All posts" size="small" text />
        </div>
        <template v-if="d">
          <div v-if="d.review.length" class="list-row">
            <div class="min-w-0">
              <a class="list-row-title" :href="`${base}/editor`">Site changes waiting for review</a>
              <span class="list-row-sub" dir="auto">Asked by {{ names.format(d.review) }}</span>
            </div>
            <span class="chip chip-warning">Review</span>
          </div>
          <div v-for="p in upcoming.slice(0, NEXT_UP_LIMIT)" :key="p.key" class="list-row">
            <div class="min-w-0">
              <a class="list-row-title" dir="auto" :href="`${base}/${p.path}`">{{ p.title }}</a>
              <span class="list-row-sub">
                <template v-if="p.author">By {{ p.author }} · </template>
                <time v-if="p.date" :datetime="p.date">{{ formatDate(p.date) }}</time>
              </span>
            </div>
            <span :class="['chip', p.status === 'Scheduled' ? 'chip-info' : 'chip-warning']">{{ p.status }}</span>
          </div>
          <div v-if="!d.review.length && !upcoming.length" class="empty-state">
            <i class="pi pi-pencil" aria-hidden="true" />
            <span>No drafts or scheduled posts. News drafts are saved in this browser only.</span>
            <Button as="a" :href="`${base}/posts/new`" label="Start a blog post" size="small" />
          </div>
          <p v-if="upcoming.length > NEXT_UP_LIMIT" class="card-subtitle">
            {{ upcoming.length - NEXT_UP_LIMIT }} more on the <a :href="`${base}/posts`">Blog posts</a> screen.
          </p>
        </template>
        <Skeleton v-else height="12rem" />
      </section>
    </div>

    <!-- Row 4: site status -->
    <section class="card card-flush dash-status" aria-labelledby="adm-status">
      <div class="card-head">
        <div>
          <h2 id="adm-status" class="card-title">
            <i class="pi pi-server text-primary" aria-hidden="true" /> Site status
          </h2>
          <p v-if="d?.mode === 'postgres'" id="adm-jobs-desc" class="card-subtitle">
            Releases scheduled posts that are due, syncs feeds, checks Google Scholar and backs up to GitHub. They also
            run on their own once a day.
          </p>
        </div>
        <Button
          v-if="d?.mode === 'postgres'"
          id="adm-run-jobs"
          icon="pi pi-play"
          :label="busy === JOBS ? 'Running…' : 'Run daily jobs'"
          :loading="busy === JOBS"
          aria-describedby="adm-jobs-desc"
          :disabled="busy !== null && busy !== JOBS"
          :aria-disabled="busy === JOBS || undefined"
          :aria-busy="busy === JOBS"
          @click="run('run-jobs', JOBS)"
        />
      </div>
      <div v-if="!d && !loadError" class="p-6" role="status">
        <span class="adm-visually-hidden">Loading the dashboard…</span>
        <Skeleton v-for="i in SKELETON_ROWS" :key="i" height="2.5rem" class="mb-3" />
      </div>
      <ul v-else-if="d" class="status-rows">
        <li v-for="r in rows" :id="`row-${r.key}`" :key="r.key" :class="`is-${r.tone}`" tabindex="-1">
          <h3 class="status-label">
            <span :class="['status-dot', `is-${r.tone}`]" aria-hidden="true" />
            {{ r.label }}
          </h3>
          <span class="status-main">
            <span v-if="r.tone in MARKER" :class="['chip', r.tone === 'nudge' ? 'chip-warning' : 'chip-secondary']">{{
              MARKER[r.tone as keyof typeof MARKER]
            }}</span>
            <span :class="['status-state', { 'is-attention': r.tone === 'attention' }]">{{ r.state }}</span>
            <template v-if="r.at">
              · <time :datetime="r.at">{{ relativeTime(r.at) }}</time>
              <span class="status-abs"> ({{ absolute(r.at) }})</span>
            </template>
            <span v-if="r.detail" class="status-detail">{{ r.detail }}</span>
            <details v-if="r.raw" class="adm-row-raw">
              <summary>
                Technical detail<span class="adm-visually-hidden">: {{ r.label }}</span>
              </summary>
              <code>{{ r.raw }}</code>
            </details>
            <span v-if="r.action && r.action.kind in CHANGES" :id="`changes-${r.key}`" class="status-detail"
              >{{ r.action.label }} {{ CHANGES[r.action.kind as RunKind] }}</span
            >
            <a
              v-if="r.link"
              class="status-link"
              :href="r.link.url"
              target="_blank"
              rel="noopener"
              :aria-label="`${r.link.label}: ${r.label} (opens in a new tab)`"
              >{{ r.link.label }} <span aria-hidden="true">↗</span></a
            >
          </span>
          <span class="adm-row-action">
            <a
              v-if="r.action?.kind === 'screen'"
              :href="`${base}/${r.action.path}`"
              :aria-label="`${r.action.label}: ${r.label}`"
              >{{ r.action.label }} <span aria-hidden="true">→</span></a
            >
            <a
              v-else-if="r.action?.kind === 'external'"
              :href="r.action.url"
              :aria-label="`${r.action.label}: ${r.label} (opens in a new tab)`"
              target="_blank"
              rel="noopener"
              >{{ r.action.label }} <span aria-hidden="true">↗</span></a
            >
            <Button
              v-else-if="r.action && isRun(r.action.kind)"
              size="small"
              severity="secondary"
              outlined
              :label="busy === r.key || watching?.key === r.key ? 'Working…' : r.action.label"
              :loading="busy === r.key || watching?.key === r.key"
              :disabled="busy !== null && busy !== r.key"
              :aria-disabled="busy === r.key || watching?.key === r.key || undefined"
              :aria-busy="busy === r.key || watching?.key === r.key"
              :aria-label="`${r.action.label}: ${r.label}`"
              :aria-describedby="r.action.kind in CHANGES ? `changes-${r.key}` : undefined"
              @click="run(r.action.kind as RunKind, r.key)"
            />
          </span>
        </li>
      </ul>
    </section>
  </AdminShell>
</template>

<style scoped>
.dash-grid {
  display: grid;
  gap: 1rem;
  margin-block-end: 1rem;
}
.dash-stats {
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
}
.dash-charts {
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
}
.dash-lists {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (max-width: 1399.98px) {
  .dash-charts {
    grid-template-columns: 1fr;
  }
  .dash-lists {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 991.98px) {
  .dash-lists {
    grid-template-columns: 1fr;
  }
}
.dash-verdict {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-block-end: 1rem;
  padding-block: 1rem;
}
.dash-verdict .stat-icon {
  margin: 0;
  width: 2.5rem;
  height: 2.5rem;
  font-size: 1.05rem;
}
.dash-verdict p {
  margin: 0;
  color: var(--app-heading);
  font-weight: 500;
}
.dash-verdict.is-attention {
  box-shadow:
    inset 4px 0 0 var(--c-danger),
    var(--app-shadow-card);
}
.dash-chart {
  height: 300px;
}
.dash-live-dot {
  color: var(--c-success);
  font-size: 0.5rem;
  vertical-align: middle;
  animation: dash-pulse 2s ease-in-out infinite;
}
@keyframes dash-pulse {
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dash-live-dot {
    animation: none;
  }
}
.dash-ring {
  position: relative;
  height: 230px;
}
.dash-ring-total {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  pointer-events: none;
}
.dash-ring-total span {
  color: var(--p-primary-color);
  font-size: 0.8125rem;
  font-weight: 600;
}
.dash-ring-total strong {
  color: var(--app-heading);
  font-size: 1.5rem;
  font-weight: 600;
}
.dash-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem 1rem;
  margin: 1.25rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.8125rem;
}
.dash-legend li {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
.dash-legend li span:last-child {
  color: var(--app-muted);
}
.dash-swatch {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
}
.dash-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8125rem;
  font-weight: 500;
}
.dash-off {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-block-end: 1rem;
}
.dash-off .stat-icon {
  margin: 0;
  flex: none;
}
.dash-rank {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  font-size: 0.8125rem;
  font-weight: 700;
}
.dash-country {
  display: grid;
  gap: 0.375rem;
  padding-block: 0.5rem;
}
.dash-flag {
  font-size: 1.25rem;
  line-height: 1;
}
.dash-channels {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin: 0.75rem 0 0;
}
a.list-row-title {
  display: block;
  text-decoration: none;
}
a.list-row-title:hover {
  color: var(--p-primary-color);
}

/* Site status: ruled rows in a flush card. */
.status-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.status-rows > li {
  display: grid;
  grid-template-columns: minmax(10rem, 13rem) minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.5rem 1.25rem;
  padding: 1rem 1.5rem;
  scroll-margin-top: calc(var(--app-header-height) + 1rem);
}
.status-rows > li + li {
  border-top: 1px solid var(--app-border);
}
.status-rows > li:focus {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
}
.status-rows > li.is-attention {
  background: color-mix(in srgb, var(--c-danger) 5%, transparent);
}
.status-label {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin: 0;
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
}
.status-dot {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--c-success);
}
.status-dot.is-attention {
  background: var(--c-danger);
}
.status-dot.is-nudge {
  background: var(--c-warning);
}
.status-dot.is-unknown,
.status-dot.is-unseen,
.status-dot.is-off {
  background: var(--app-menu-heading);
}
.status-main {
  color: var(--app-body);
  font-size: 0.875rem;
}
.status-main .chip {
  margin-inline-end: 0.375rem;
}
.status-state {
  color: var(--app-heading);
}
.status-state.is-attention {
  color: var(--c-danger);
  font-weight: 500;
}
.status-abs,
.status-detail {
  color: var(--app-muted);
}
.status-detail {
  display: block;
  margin-block-start: 0.125rem;
  font-size: 0.8125rem;
}
.status-link {
  display: inline-block;
  margin-block-start: 0.25rem;
  font-size: 0.8125rem;
}
.status-rows .adm-row-action {
  justify-self: end;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
}
@media (max-width: 767.98px) {
  .status-rows > li {
    grid-template-columns: 1fr;
    padding-inline: 1rem;
  }
  .status-rows .adm-row-action {
    justify-self: start;
  }
}
.dash-ring :deep(.p-chart) {
  height: 100%;
}
</style>
