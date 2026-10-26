<script setup lang="ts">
import { ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import MediaGrid from './MediaGrid.vue';
import ContentModal from './ui/content/ContentModal.vue';
import { HIDE_ICON } from './ui/content/pt';

defineProps<{ modelValue?: string; folder: 'content' | 'site'; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>();
const open = ref(false);

function pick(url: string) {
  emit('update:modelValue', url);
  open.value = false;
}
</script>

<template>
  <div class="ip-row">
    <InputText
      :model-value="modelValue ?? ''"
      :aria-label="`${label} path`"
      fluid
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value || undefined)"
    />
    <Button icon="pi pi-images" label="Choose…" severity="secondary" outlined :pt="HIDE_ICON" @click="open = true" />
  </div>
  <ContentModal v-if="open" wide :aria-label="`Choose ${label}`" @keydown.esc="open = false">
    <div class="ip-head">
      <h2>Choose an image</h2>
      <Button
        icon="pi pi-times"
        label="Close"
        severity="secondary"
        text
        size="small"
        :pt="HIDE_ICON"
        @click="open = false"
      />
    </div>
    <MediaGrid :folder="folder" pickable @pick="pick" />
  </ContentModal>
</template>

<style scoped>
.ip-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.ip-row > :first-child {
  flex: 1;
  min-width: 0;
}
.ip-row > :deep(.p-button) {
  flex: none;
}
.ip-row :deep(input.p-inputtext) {
  padding: var(--p-inputtext-padding-y) var(--p-inputtext-padding-x);
  border-color: var(--p-inputtext-border-color);
  font-size: 0.9375rem;
}
.ip-row :deep(input.p-inputtext:enabled:hover) {
  border-color: var(--p-inputtext-hover-border-color);
}
.ip-row :deep(input.p-inputtext:enabled:focus) {
  border-color: var(--p-inputtext-focus-border-color);
}
.ip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
</style>
