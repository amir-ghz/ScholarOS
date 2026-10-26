<script setup lang="ts">
import Delta from './Delta.vue';

/** A Conca-style stat tile: tinted icon disc, small label, big value, and the change against the previous period. */
defineProps<{
  icon: string;
  /** chip-* colour of the icon disc: primary, success, warning, danger, info, pink, secondary. */
  tint: string;
  label: string;
  value: string;
  /** Percent change; null: no previous period to compare with; undefined: no change chip. */
  delta?: number | null;
  /** What the change is against, e.g. "vs previous 30 days". */
  against?: string;
  /** A fall is good news (e.g. bounce rate). */
  inverse?: boolean;
  href?: string;
}>();
</script>

<template>
  <component :is="href ? 'a' : 'div'" :href="href" class="card stat-card">
    <span :class="['stat-icon', `tint-${tint}`]" aria-hidden="true"><i :class="['pi', icon]" /></span>
    <span class="stat-label">{{ label }}</span>
    <p class="stat-value">{{ value }}</p>
    <span v-if="delta !== undefined" class="stat-trend">
      <Delta :value="delta" :inverse="inverse" />
      <span>{{ against }}</span>
    </span>
    <span v-else-if="against" class="stat-trend stat-trend-plain">{{ against }}</span>
  </component>
</template>

<style scoped>
.stat-card {
  display: block;
  color: inherit;
  text-decoration: none !important;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
}
a.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--app-shadow-float);
}
.stat-trend-plain {
  padding-inline-start: 0.625rem;
}
</style>
