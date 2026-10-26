import { ref, watch, type Ref } from 'vue';
import { api } from '../api';
import type { AnalyticsReport, Range } from '../../lib/analytics/report';
import type { Palette } from './theme';

export type { AnalyticsReport, Range };
export const RANGE_OPTIONS: { label: string; value: Range; against: string }[] = [
  { label: 'Last 7 days', value: '7d', against: 'vs previous 7 days' },
  { label: 'Last 30 days', value: '30d', against: 'vs previous 30 days' },
  { label: 'Last 90 days', value: '90d', against: 'vs previous 90 days' },
  { label: 'Last 12 months', value: '12m', against: 'vs previous 12 months' },
];
export const againstFor = (r: Range) => RANGE_OPTIONS.find((o) => o.value === r)!.against;

/** The analytics report for `range`, reloaded when it changes; `error` holds the message when it can't load. */
export function useAnalytics(range: Ref<Range>) {
  /** `local`: pnpm dev's database (sample data offered); `demo`: sample views are in these numbers. */
  const report = ref<(AnalyticsReport & { local?: boolean; demo?: boolean }) | null>(null);
  const error = ref('');
  const loading = ref(false);
  async function load() {
    loading.value = true;
    error.value = '';
    try {
      report.value = await api<AnalyticsReport & { local?: boolean; demo?: boolean }>(`analytics?range=${range.value}`);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }
  watch(range, () => void load());
  return { report, error, loading, load };
}

const dayLabel = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthLabel = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
const label = (at: string) =>
  at.length === 7 ? monthLabel.format(new Date(`${at}-01`)) : dayLabel.format(new Date(at));

function axes(p: Palette) {
  return {
    x: {
      grid: { display: false },
      border: { display: false },
      ticks: { color: p.muted, font: { family: 'Inter', size: 11 }, maxRotation: 0, autoSkipPadding: 16 },
    },
    y: {
      beginAtZero: true,
      grid: { color: p.border, drawTicks: false },
      border: { display: false, dash: [4, 4] },
      ticks: { color: p.muted, font: { family: 'Inter', size: 11 }, padding: 8, precision: 0 },
    },
  };
}
const legend = (p: Palette) => ({
  position: 'top' as const,
  align: 'center' as const,
  labels: {
    color: p.text,
    usePointStyle: true,
    pointStyle: 'circle',
    boxWidth: 8,
    font: { family: 'Inter', size: 12 },
  },
});
const tooltip = {
  backgroundColor: '#191822',
  padding: 10,
  cornerRadius: 6,
  titleFont: { family: 'Inter' },
  bodyFont: { family: 'Inter' },
};

/** Visitors and page views over time: two smooth lines, the first filled (Conca's "Revenue Overview"). */
export function trafficChart(r: AnalyticsReport, p: Palette) {
  return {
    data: {
      labels: r.series.map((s) => label(s.at)),
      datasets: [
        {
          label: 'Visitors',
          data: r.series.map((s) => s.visitors),
          borderColor: p.series[0],
          backgroundColor: p.primarySoft,
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
        {
          label: 'Page views',
          data: r.series.map((s) => s.views),
          borderColor: p.series[1],
          backgroundColor: 'transparent',
          tension: 0.4,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: legend(p), tooltip },
      scales: axes(p),
    },
  };
}

/** A ring with the total in the middle (Conca's "Category Enrollment"); the legend is drawn by the page. */
export function ringChart(items: { name: string; value: number }[], p: Palette) {
  return {
    data: {
      labels: items.map((i) => i.name),
      datasets: [
        {
          data: items.map((i) => i.value),
          backgroundColor: items.map((_, i) => p.series[i % p.series.length]),
          borderColor: p.card,
          borderWidth: 3,
          hoverOffset: 6,
        },
      ],
    },
    options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, tooltip } },
  };
}

/** Bars per category (devices, channels…). */
export function barChart(items: { name: string; value: number }[], p: Palette, horizontal = false) {
  return {
    data: {
      labels: items.map((i) => i.name),
      datasets: [
        {
          data: items.map((i) => i.value),
          backgroundColor: items.map((_, i) => p.series[i % p.series.length]),
          borderRadius: 6,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip },
      scales: horizontal ? { x: axes(p).y, y: axes(p).x } : axes(p),
    },
  };
}

/** Channel → icon and readable name. */
export const CHANNELS: Record<string, { label: string; icon: string }> = {
  direct: { label: 'Direct', icon: 'pi-arrow-right' },
  search: { label: 'Search engines', icon: 'pi-search' },
  social: { label: 'Social media', icon: 'pi-share-alt' },
  email: { label: 'Email', icon: 'pi-envelope' },
  referral: { label: 'Other websites', icon: 'pi-link' },
  campaign: { label: 'Campaigns', icon: 'pi-megaphone' },
};

/** Traffic sources as a polar area (Conca's "Traffic Sources"). */
export function polarChart(items: { name: string; value: number }[], p: Palette) {
  return {
    data: {
      labels: items.map((i) => i.name),
      datasets: [
        {
          data: items.map((i) => i.value),
          backgroundColor: items.map((_, i) => `${p.series[i % p.series.length]}cc`),
          borderColor: p.card,
          borderWidth: 2,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { ...legend(p), position: 'bottom' as const },
        tooltip,
      },
      scales: {
        r: {
          grid: { color: p.border },
          angleLines: { color: p.border },
          ticks: { display: false },
        },
      },
    },
  };
}
