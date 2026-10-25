<script setup lang="ts">
import { computed, ref } from 'vue';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import AdminShell from './AdminShell.vue';
import MediaGrid from './MediaGrid.vue';
import type { AdminCtx } from './types';

defineProps<{ ctx: AdminCtx }>();
const TABS = [
  {
    id: 'content',
    label: 'Content images',
    icon: 'pi-images',
    note: 'Used by posts, people, projects and other entries. Optimized at build time.',
  },
  {
    id: 'site',
    label: 'Site images',
    icon: 'pi-globe',
    note: 'Used by pages, settings and images inside post text. Served as-is from /images.',
  },
] as const;
const folder = ref<'content' | 'site'>('content');
const note = computed(() => TABS.find((t) => t.id === folder.value)!.note);
</script>

<template>
  <AdminShell :ctx="ctx" active="media" title="Media">
    <section class="card card-flush">
      <Tabs v-model:value="folder" lazy>
        <TabList :pt="{ tabList: { 'aria-label': 'Image folders' } }">
          <Tab v-for="t in TABS" :key="t.id" :value="t.id">
            <i :class="['pi', t.icon]" aria-hidden="true" />
            {{ t.label }}
          </Tab>
        </TabList>
        <TabPanels>
          <TabPanel v-for="t in TABS" :key="t.id" :value="t.id">
            <p class="card-subtitle media-note">
              <i class="pi pi-info-circle" aria-hidden="true" />
              {{ note }}
            </p>
            <MediaGrid :folder="t.id" />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  </AdminShell>
</template>

<style scoped>
.card-flush :deep(.p-tablist) {
  padding-inline: 0.75rem;
}
.card-flush :deep(.p-tablist-tab-list) {
  background: transparent;
}
.card-flush :deep(.p-tab) {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.125rem 0.875rem;
  font-size: 0.9375rem;
}
.card-flush :deep(.p-tabpanels) {
  padding: 1.5rem;
  background: transparent;
}
.media-note {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1.25rem;
  font-size: 0.875rem;
}
@media (max-width: 575.98px) {
  .card-flush :deep(.p-tabpanels) {
    padding: 1rem;
  }
}
</style>
