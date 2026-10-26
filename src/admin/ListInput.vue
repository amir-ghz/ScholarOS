<script setup lang="ts">
import Button from 'primevue/button';
import { HIDE_ICON } from './ui/content/pt';

const props = defineProps<{ items: unknown[]; blank?: () => unknown; fixed?: boolean; addLabel?: string }>();
const emit = defineEmits<{ update: [items: unknown[]] }>();

function move(index: number, by: number) {
  const next = [...props.items];
  [next[index], next[index + by]] = [next[index + by], next[index]];
  emit('update', next);
}
</script>

<template>
  <div class="li-list">
    <div v-for="(item, index) in items" :key="index" class="li-row">
      <div class="li-item"><slot :item="item" :index="index" /></div>
      <span class="li-tools">
        <Button
          icon="pi pi-arrow-up"
          severity="secondary"
          text
          size="small"
          :disabled="index === 0"
          aria-label="Move up"
          :pt="HIDE_ICON"
          @click="move(index, -1)"
        />
        <Button
          icon="pi pi-arrow-down"
          severity="secondary"
          text
          size="small"
          :disabled="index === items.length - 1"
          aria-label="Move down"
          :pt="HIDE_ICON"
          @click="move(index, 1)"
        />
        <Button
          v-if="!fixed"
          icon="pi pi-times"
          severity="danger"
          text
          size="small"
          aria-label="Remove"
          :pt="HIDE_ICON"
          @click="
            emit(
              'update',
              items.filter((_, i) => i !== index),
            )
          "
        />
      </span>
    </div>
    <Button
      v-if="!fixed && blank"
      class="li-add"
      icon="pi pi-plus"
      :label="addLabel ?? 'Add'"
      severity="secondary"
      outlined
      size="small"
      :pt="HIDE_ICON"
      @click="emit('update', [...items, blank()])"
    />
  </div>
</template>

<style scoped>
.li-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}
.li-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}
.li-item {
  flex: 1;
  min-width: 0;
}
.li-tools {
  display: flex;
  flex: none;
  gap: 0.125rem;
  padding-block-start: 0.125rem;
}
.li-tools :deep(.p-button) {
  width: var(--li-tool, 2.25rem);
  height: 2.25rem;
  padding: 0;
}
.li-add {
  align-self: flex-start;
}
</style>
