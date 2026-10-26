import { onBeforeUnmount, onMounted, ref } from 'vue';

/** The admin palette as Chart.js and the map need it: concrete colours, re-read when light/dark changes. */
export interface Palette {
  dark: boolean;
  primary: string;
  primarySoft: string;
  text: string;
  muted: string;
  border: string;
  card: string;
  /** Categorical series, in order: indigo, orange, teal, pink, sky, amber, green, violet, slate. */
  series: string[];
}

const SERIES = ['#5f4afe', '#fb6514', '#13c4a3', '#ee46bc', '#0ba5ec', '#f79009', '#219653', '#a48afb', '#8a8995'];

function read(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.classList.contains('app-dark');
  return {
    dark,
    primary: '#5f4afe',
    primarySoft: dark ? 'rgba(95, 74, 254, 0.28)' : 'rgba(95, 74, 254, 0.14)',
    text: v('--app-body', '#57575a'),
    muted: v('--app-muted', '#8a8995'),
    border: v('--app-border', '#efefef'),
    card: v('--app-card', '#ffffff'),
    series: SERIES,
  };
}

/** A reactive palette that follows the `.app-dark` class on <html>. */
export function usePalette() {
  const palette = ref<Palette>(read());
  let observer: MutationObserver | undefined;
  onMounted(() => {
    palette.value = read();
    observer = new MutationObserver(() => (palette.value = read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  });
  onBeforeUnmount(() => observer?.disconnect());
  return palette;
}

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
/** "DE" → "Germany"; "Unknown" stays. */
export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
/** "DE" → 🇩🇪 (regional-indicator letters); a globe for anything else. */
export function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

/** Percent change from `previous` to `current`, one decimal; null when there's nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const whole = new Intl.NumberFormat('en');
