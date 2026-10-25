<script setup lang="ts">
import { computed } from 'vue';

/** A change chip: ↑ 12.5% in green, ↓ 3% in red (reversed with `inverse`), "New" when there was nothing before. */
const props = defineProps<{ value: number | null; inverse?: boolean }>();
const tone = computed(() => {
  if (props.value === null) return 'chip-primary';
  if (props.value === 0) return 'chip-secondary';
  return props.value > 0 !== !!props.inverse ? 'chip-success' : 'chip-danger';
});
const text = computed(() =>
  props.value === null ? 'New' : `${Math.abs(props.value).toLocaleString('en', { maximumFractionDigits: 1 })}%`,
);
const said = computed(() =>
  props.value === null
    ? 'new this period'
    : props.value === 0
      ? 'no change'
      : `${props.value > 0 ? 'up' : 'down'} ${Math.abs(props.value)} percent`,
);
</script>

<template>
  <span :class="['chip', tone]">
    <i
      v-if="value"
      :class="['pi', value > 0 ? 'pi-arrow-up' : 'pi-arrow-down']"
      style="font-size: 0.625rem"
      aria-hidden="true"
    />
    <span aria-hidden="true">{{ text }}</span>
    <span class="adm-visually-hidden">{{ said }}</span>
  </span>
</template>
