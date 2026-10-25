<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Chart from 'primevue/chart';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Select from 'primevue/select';
import Skeleton from 'primevue/skeleton';
import AdminShell from './AdminShell.vue';
import { api, report as reportError, toast } from './api';
import StatCard from './ui/StatCard.vue';
import Delta from './ui/Delta.vue';
import WorldMap from './ui/WorldMap.vue';
import {
  CHANNELS,
  RANGE_OPTIONS,
  againstFor,
  barChart,
  polarChart,
  ringChart,
  trafficChart,
  useAnalytics,
  type Range,
} from './ui/analytics';
import { change, compact, countryName, flag, usePalette, whole } from './ui/theme';
import type { AdminCtx } from './types';

/** Site analytics (Postgres mode): first-party and cookieless (src/lib/analytics), laid out like Conca's analytics dashboard. */
defineProps<{ ctx: AdminCtx }>();
const range = ref<Range>('30d');
const { report, error, loading, load } = useAnalytics(range);
const palette = usePalette();
onMounted(() => void load());

const t = computed(() => report.value?.totals);
const p = computed(() => report.value?.previous);
const traffic = computed(() => (report.value ? trafficChart(report.value, palette.value) : null));
const sources = computed(() =>
  polarChart(
    (report.value?.channels ?? []).map((c) => ({ name: CHANNELS[c.name]?.label ?? c.name, value: c.visitors })),
    palette.value,
  ),
);
const devices = computed(() =>
  ringChart(
    (report.value?.devices ?? []).map((d) => ({ name: label(d.name), value: d.visitors })),
    palette.value,
  ),
);
const osBars = computed(() =>
  barChart(
    (report.value?.os ?? []).map((o) => ({ name: o.name, value: o.visitors })),
    palette.value,
    true,
  ),
);
const mapValues = computed(() =>
  Object.fromEntries(
    (report.value?.countries ?? []).filter((c) => c.name !== 'Unknown').map((c) => [c.name, c.visitors]),
  ),
);
const countries = computed(() => report.value?.countries.slice(0, 8) ?? []);
const countryMax = computed(() => Math.max(1, ...countries.value.map((c) => c.visitors)));
const browserTotal = computed(() => report.value?.browsers.reduce((s, b) => s + b.visitors, 0) || 1);
const empty = computed(() => !!report.value && report.value.totals.views === 0);
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const BROWSER_ICON: Record<string, string> = {
  Chrome: 'pi-globe',
  Safari: 'pi-compass',
  Firefox: 'pi-globe',
  Edge: 'pi-microsoft',
  Opera: 'pi-circle',
  'Samsung Internet': 'pi-mobile',
};

const demoBusy = ref(false);
async function sample(add: boolean) {
  demoBusy.value = true;
  try {
    const r = await api<{ added?: number; removed?: number }>('analytics/demo', { method: add ? 'POST' : 'DELETE' });
    toast(
      add
        ? `Added ${whole.format(r.added ?? 0)} sample page views`
        : `Removed ${whole.format(r.removed ?? 0)} sample page views`,
    );
    await load();
  } catch (e) {
    reportError(e);
  } finally {
    demoBusy.value = false;
  }
}
</script>

<template>
  <AdminShell :ctx="ctx" active="analytics" title="Analytics">
    <template #actions>
      <span v-if="report" class="chip chip-success an-live">
        <i class="pi pi-circle-fill" aria-hidden="true" /> {{ report.live }} on the site now
      </span>
      <Select v-model="range" :options="RANGE_OPTIONS" option-label="label" option-value="value" aria-label="Period" />
      <Button
        icon="pi pi-refresh"
        severity="secondary"
        outlined
        aria-label="Refresh"
        :loading="loading"
        @click="load"
      />
    </template>

    <div v-if="error" class="adm-banner adm-banner-error" role="alert">
      <span>Analytics could not load: {{ error }}</span>
      <Button label="Retry" size="small" severity="secondary" @click="load" />
    </div>

    <div v-if="report?.local" class="card an-sample">
      <span class="stat-icon tint-info" aria-hidden="true"><i class="pi pi-info-circle" /></span>
      <p v-if="report.demo">
        <strong>Sample data is in these numbers.</strong> It exists only on this computer's database; remove it before
        you judge real traffic.
      </p>
      <p v-else>
        <strong>Running locally.</strong> Visits from <code>localhost</code> carry no location. Load sample data to see
        every chart filled in; it stays on this computer.
      </p>
      <Button
        :label="report.demo ? 'Remove sample data' : 'Load sample data'"
        :icon="report.demo ? 'pi pi-trash' : 'pi pi-database'"
        :severity="report.demo ? 'danger' : 'info'"
        outlined
        size="small"
        :loading="demoBusy"
        @click="sample(!report.demo)"
      />
    </div>

    <!-- Totals -->
    <div class="an-grid an-stats">
      <StatCard
        icon="pi-users"
        tint="primary"
        label="Visitors"
        :value="t ? compact.format(t.visitors) : '–'"
        :delta="t && p ? change(t.visitors, p.visitors) : undefined"
        :against="againstFor(range)"
      />
      <StatCard
        icon="pi-eye"
        tint="warning"
        label="Page views"
        :value="t ? compact.format(t.views) : '–'"
        :delta="t && p ? change(t.views, p.views) : undefined"
        :against="againstFor(range)"
      />
      <StatCard
        icon="pi-file"
        tint="success"
        label="Pages per visitor"
        :value="t ? String(t.viewsPerVisitor) : '–'"
        :against="'in the same period'"
      />
      <StatCard
        icon="pi-sign-out"
        tint="pink"
        label="Bounce rate"
        :value="t ? `${t.bounce}%` : '–'"
        :delta="t && p ? change(t.bounce, p.bounce) : undefined"
        :against="againstFor(range)"
        inverse
      />
    </div>

    <div v-if="empty" class="card empty-state an-empty">
      <i class="pi pi-chart-line" aria-hidden="true" />
      <strong>No visits in this period yet.</strong>
      <span>Every public page counts itself once it's open in a browser: no cookies, nothing to set up.</span>
    </div>

    <template v-else>
      <!-- Traffic and sources -->
      <div class="an-grid an-7-5">
        <section class="card" aria-labelledby="an-traffic">
          <div class="card-head">
            <h2 id="an-traffic" class="card-title">Visitors over time</h2>
            <span v-if="t" class="card-subtitle"
              >{{ whole.format(t.visitors) }} visitors · {{ whole.format(t.views) }} views</span
            >
          </div>
          <Skeleton v-if="!traffic" height="320px" />
          <Chart v-else type="line" :data="traffic.data" :options="traffic.options" class="an-chart" />
        </section>
        <section class="card" aria-labelledby="an-sources">
          <div class="card-head">
            <h2 id="an-sources" class="card-title">Traffic sources</h2>
          </div>
          <Skeleton v-if="!report" shape="circle" size="260px" class="mx-auto" />
          <Chart v-else type="polarArea" :data="sources.data" :options="sources.options" class="an-chart" />
        </section>
      </div>

      <!-- Places -->
      <div class="an-grid an-8-4">
        <section class="card" aria-labelledby="an-map">
          <div class="card-head">
            <h2 id="an-map" class="card-title">Visitors around the world</h2>
            <span class="card-subtitle">From the host's location headers; local visits have none.</span>
          </div>
          <Skeleton v-if="!report" height="340px" />
          <WorldMap v-else :values="mapValues" />
        </section>
        <section class="card" aria-labelledby="an-countries">
          <div class="card-head">
            <h2 id="an-countries" class="card-title">Visitors by country</h2>
          </div>
          <template v-if="countries.length">
            <div v-for="c in countries" :key="c.name" class="an-country">
              <span class="an-flag" aria-hidden="true">{{ flag(c.name) }}</span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <p class="list-row-title">{{ countryName(c.name) }}</p>
                  <Delta :value="change(c.visitors, c.previous)" />
                </div>
                <span class="list-row-sub">{{ whole.format(c.visitors) }} visitors</span>
                <div class="progress mt-1">
                  <span :style="{ width: `${(c.visitors / countryMax) * 100}%`, background: 'var(--c-primary)' }" />
                </div>
              </div>
            </div>
          </template>
          <Skeleton v-else-if="!report" height="18rem" />
        </section>
      </div>

      <!-- Pages and referrers -->
      <div class="an-grid an-7-5">
        <section class="card card-flush" aria-labelledby="an-pages">
          <div class="card-head">
            <h2 id="an-pages" class="card-title"><i class="pi pi-file text-primary" aria-hidden="true" /> Top pages</h2>
          </div>
          <DataTable :value="report?.pages ?? []" :loading="!report" size="small" striped-rows>
            <Column header="Page">
              <template #body="{ data }">
                <a class="an-page" :href="data.path" target="_blank" rel="noopener">
                  <strong dir="auto">{{ data.title }}</strong>
                  <span>{{ data.path }}</span>
                </a>
              </template>
            </Column>
            <Column field="visitors" header="Visitors" class="an-num" />
            <Column field="views" header="Views" class="an-num" />
            <template #empty><span class="card-subtitle">No pages yet.</span></template>
          </DataTable>
        </section>
        <section class="card card-flush" aria-labelledby="an-refs">
          <div class="card-head">
            <h2 id="an-refs" class="card-title">
              <i class="pi pi-link text-primary" aria-hidden="true" /> Referring sites
            </h2>
          </div>
          <DataTable :value="report?.referrers ?? []" :loading="!report" size="small" striped-rows>
            <Column header="Site">
              <template #body="{ data }">
                <span class="flex items-center gap-2">
                  <i class="pi pi-link text-muted-color" aria-hidden="true" />
                  {{ data.name }}
                </span>
              </template>
            </Column>
            <Column field="visitors" header="Visitors" class="an-num" />
            <template #empty><span class="card-subtitle">No other site has sent visitors yet.</span></template>
          </DataTable>
        </section>
      </div>

      <!-- Devices, browsers, systems, cities -->
      <div class="an-grid an-4">
        <section class="card" aria-labelledby="an-devices">
          <div class="card-head"><h2 id="an-devices" class="card-title">Devices</h2></div>
          <div class="an-ring">
            <Chart v-if="report" type="doughnut" :data="devices.data" :options="devices.options" />
          </div>
          <ul class="an-legend">
            <li v-for="(d, i) in report?.devices ?? []" :key="d.name">
              <span class="an-swatch" :style="{ background: palette.series[i % palette.series.length] }" />
              <i
                :class="['pi', d.name === 'mobile' ? 'pi-mobile' : d.name === 'tablet' ? 'pi-tablet' : 'pi-desktop']"
                aria-hidden="true"
              />
              {{ label(d.name) }}
              <span>{{ whole.format(d.visitors) }}</span>
            </li>
          </ul>
        </section>
        <section class="card" aria-labelledby="an-browsers">
          <div class="card-head"><h2 id="an-browsers" class="card-title">Browsers</h2></div>
          <div v-for="b in report?.browsers ?? []" :key="b.name" class="list-row">
            <span class="flex items-center gap-2">
              <span class="stat-icon tint-secondary an-mini" aria-hidden="true"
                ><i :class="['pi', BROWSER_ICON[b.name] ?? 'pi-globe']"
              /></span>
              <span class="list-row-title">{{ b.name }}</span>
            </span>
            <span class="chip chip-primary">{{ Math.round((b.visitors / browserTotal) * 100) }}%</span>
          </div>
        </section>
        <section class="card" aria-labelledby="an-os">
          <div class="card-head"><h2 id="an-os" class="card-title">Operating systems</h2></div>
          <div class="an-bars"><Chart v-if="report" type="bar" :data="osBars.data" :options="osBars.options" /></div>
        </section>
        <section class="card" aria-labelledby="an-cities">
          <div class="card-head"><h2 id="an-cities" class="card-title">Top cities</h2></div>
          <div v-for="c in report?.cities ?? []" :key="`${c.name}-${c.country}`" class="list-row">
            <span class="flex min-w-0 items-center gap-2">
              <span aria-hidden="true">{{ flag(c.country ?? '') }}</span>
              <span class="list-row-title" dir="auto">{{ c.name }}</span>
            </span>
            <span class="list-row-sub">{{ whole.format(c.visitors) }}</span>
          </div>
          <div v-if="report && !report.cities.length" class="empty-state">
            <i class="pi pi-map-marker" aria-hidden="true" /> No locations yet (local visits have none).
          </div>
        </section>
      </div>
    </template>

    <p class="an-privacy">
      <i class="pi pi-shield" aria-hidden="true" />
      Counted without cookies or stored IP addresses: a visitor is a hash that changes every day, signed-in admins and
      bots are left out, and browsers that ask not to be tracked aren't counted. Views older than 400 days are deleted.
    </p>
  </AdminShell>
</template>

<style scoped>
.an-grid {
  display: grid;
  gap: 1rem;
  margin-block-end: 1rem;
}
.an-stats {
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
}
.an-7-5 {
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
}
.an-8-4 {
  grid-template-columns: minmax(0, 8fr) minmax(0, 4fr);
}
.an-4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
@media (max-width: 1399.98px) {
  .an-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 1199.98px) {
  .an-7-5,
  .an-8-4 {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 767.98px) {
  .an-4 {
    grid-template-columns: 1fr;
  }
}
.an-live .pi {
  font-size: 0.45rem;
}
.an-sample {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-block-end: 1rem;
  padding-block: 1rem;
}
.an-sample .stat-icon {
  flex: none;
  margin: 0;
  width: 2.5rem;
  height: 2.5rem;
}
.an-sample p {
  flex: 1;
  margin: 0;
  font-size: 0.875rem;
}
@media (max-width: 767.98px) {
  .an-sample {
    flex-wrap: wrap;
  }
}
.an-empty {
  margin-block-end: 1rem;
}
.an-chart {
  height: 320px;
}
.an-country {
  display: flex;
  gap: 0.75rem;
  padding-block: 0.5rem;
}
.an-flag {
  font-size: 1.5rem;
  line-height: 1.2;
}
.an-page {
  display: grid;
  color: inherit;
  text-decoration: none !important;
}
.an-page strong {
  color: var(--app-heading);
  font-weight: 600;
}
.an-page:hover strong {
  color: var(--p-primary-color);
}
.an-page span {
  color: var(--app-muted);
  font-size: 0.75rem;
}
:deep(.an-num) {
  width: 6rem;
  text-align: end;
}
.an-ring {
  height: 190px;
}
.an-bars {
  height: 230px;
}
.an-legend {
  display: grid;
  gap: 0.375rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.875rem;
}
.an-legend li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.an-legend li span:last-child {
  margin-inline-start: auto;
  color: var(--app-muted);
}
.an-swatch {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
}
.an-mini {
  width: 2rem;
  height: 2rem;
  margin: 0;
  font-size: 0.875rem;
}
.an-privacy {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  max-width: 60rem;
  margin: 1.5rem auto 0;
  color: var(--app-muted);
  font-size: 0.8125rem;
  text-align: center;
  justify-content: center;
}
.an-privacy .pi {
  margin-block-start: 0.2rem;
  color: var(--c-success);
}
.an-ring :deep(.p-chart) {
  height: 100%;
}
.an-bars :deep(.p-chart) {
  height: 100%;
}
</style>
