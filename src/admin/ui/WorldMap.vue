<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import 'jsvectormap/dist/jsvectormap.css';
import { countryName, usePalette, whole } from './theme';

/** A world map shaded by visitors per country (jsVectorMap, MIT), in the admin palette, light or dark. */
const props = defineProps<{ values: Record<string, number>; label?: string }>();
const el = ref<HTMLDivElement | null>(null);
const palette = usePalette();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsVectorMap ships no types
let map: any = null;

/** Five shades from light to deep indigo; each country gets the shade of its share of the busiest country (log scale). */
const SHADES_LIGHT = ['#dcd6ff', '#b9adff', '#9583ff', '#6f58fe', '#4a33e6'];
const SHADES_DARK = ['#3a2f8f', '#4d3cc2', '#6450f0', '#8c78fe', '#b6a8ff'];
function buckets(values: Record<string, number>): Record<string, string> {
  const max = Math.max(1, ...Object.values(values));
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, n]) => n > 0)
      .map(([code, n]) => [code, `s${Math.min(4, Math.floor((Math.log(n + 1) / Math.log(max + 1)) * 5))}`]),
  );
}

let seq = 0;
async function draw() {
  const mine = ++seq;
  const { default: jsVectorMap } = await import('jsvectormap');
  // The world map file registers itself on the global the library normally installs.
  (window as unknown as { jsVectorMap: unknown }).jsVectorMap = jsVectorMap;
  await import('jsvectormap/dist/maps/world.js');
  // A newer draw started while this one loaded the library: let it win, so the map is never drawn twice.
  if (mine !== seq || !el.value) return;
  map?.destroy();
  map = null;
  el.value.innerHTML = '';
  const p = palette.value;
  const values = Object.fromEntries(Object.entries(props.values).filter(([code]) => /^[A-Z]{2}$/.test(code)));
  const shades = p.dark ? SHADES_DARK : SHADES_LIGHT;
  map = new jsVectorMap({
    selector: el.value,
    map: 'world',
    zoomButtons: false,
    zoomOnScroll: false,
    regionStyle: {
      initial: { fill: p.dark ? '#2c2c30' : '#e4e3ec', stroke: p.card, strokeWidth: 0.4, fillOpacity: 1 },
      hover: { fillOpacity: 0.8, cursor: 'default' },
    },
    series: {
      regions: [
        {
          attribute: 'fill',
          scale: Object.fromEntries(shades.map((c, i) => [`s${i}`, c])),
          values: buckets(values),
        },
      ],
    },
    onRegionTooltipShow(event: Event, tooltip: { text: (html: string, asHtml?: boolean) => void }, code: string) {
      const n = values[code] ?? 0;
      tooltip.text(`${countryName(code)}: ${whole.format(n)} ${props.label ?? 'visitors'}`);
    },
  });
}

onMounted(() => void nextTick(draw));
watch([() => props.values, palette], () => void draw(), { deep: true });
onBeforeUnmount(() => map?.destroy());
</script>

<template>
  <div ref="el" class="world-map" role="img" :aria-label="`Map of ${label ?? 'visitors'} by country`" />
</template>

<style scoped>
.world-map {
  width: 100%;
  height: 340px;
}
@media (max-width: 767.98px) {
  .world-map {
    height: 220px;
  }
}
</style>
<style>
.jvm-tooltip {
  padding: 0.375rem 0.625rem;
  border-radius: 0.375rem;
  background: #191822;
  color: #fff;
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  box-shadow: var(--app-shadow-float);
}
</style>
