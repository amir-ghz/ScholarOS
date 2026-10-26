<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- config files are user data */
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import AdminShell from './AdminShell.vue';
import DocBanners from './DocBanners.vue';
import FormFields from './FormFields.vue';
import { api, report } from './api';
import { resolveOptions, text, type FieldDef, type Option } from './fields';
import { useDocument } from './useDocument';
import { HIDE_ICON } from './ui/content/pt';
import { DEFAULT_OFF, SITE_PAGES, type SitePageId } from '../lib/types';
import type { AdminCtx, CommitResult, Entry } from './types';

type Config = Record<string, any>;
defineProps<{ ctx: AdminCtx }>();

const SWITCHES: FieldDef[] = Object.entries(SITE_PAGES).map(([id, href]) => ({
  key: `pages.${id}`,
  label: `${id === 'cv' ? 'CV' : id[0].toUpperCase() + id.slice(1)} (${href})`,
  type: 'checkbox',
  default: !DEFAULT_OFF.includes(id as SitePageId),
  ...(DEFAULT_OFF.includes(id as SitePageId) && {
    hint: 'Off until you turn it on. Add it to the menu under Settings → Menu items.',
  }),
}));

const HOME: FieldDef[] = [
  text('editorial.eyebrow', 'Eyebrow'),
  {
    key: 'editorial.labRole',
    label: 'Lab role line (lab sites)',
    type: 'text',
    hint: 'Shown under the lab name. Leave empty to use department · university.',
  },
  { key: 'editorial.tagline', label: 'Tagline', type: 'textarea' },
  { key: 'editorial.bio', label: 'Bio', type: 'markdown' },
  { key: 'editorial.figure.image', label: 'Figure image', type: 'image', folder: 'site' },
  text('editorial.figure.alt', 'Figure alt text'),
  text('editorial.figure.caption', 'Figure caption'),
  { key: 'editorial.affiliations', label: 'Affiliations', type: 'list' },
  text('editorial.contact.heading', 'Contact heading'),
  { key: 'editorial.contact.text', label: 'Contact text', type: 'textarea' },
  { key: 'about.enabled', label: 'Show the about section (classic theme)', type: 'checkbox', default: true },
  text('about.title', 'About title'),
  { key: 'about.text', label: 'About text', type: 'markdown' },
  { key: 'about.image', label: 'About image', type: 'image', folder: 'site' },
  {
    key: 'homepageSections',
    label: 'Home page sections',
    type: 'objects',
    fixed: true,
    fields: [
      { key: 'id', label: 'Section', type: 'readonly' },
      { key: 'enabled', label: 'Enabled', type: 'checkbox' },
    ],
  },
];

const RESEARCH: FieldDef[] = [
  { key: 'headline', label: 'Headline', type: 'textarea' },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'areas',
    label: 'Research areas',
    type: 'objects',
    fields: [
      text('title', 'Title'),
      text('label', 'Short label'),
      text('id', 'Anchor id (optional)'),
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'body', label: 'Body (Research page)', type: 'markdown' },
      { key: 'result', label: 'Key result', type: 'textarea' },
      { key: 'figure', label: 'Figure', type: 'image', folder: 'site' },
      text('caption', 'Figure caption'),
      { key: 'publications', label: 'Related publications', type: 'pubs', optionsFrom: 'publications' },
      { key: 'tags', label: 'Tags', type: 'list' },
    ],
  },
];

const tab = ref<'pages' | 'home' | 'research'>('pages');
const home = useDocument<Config>();
const research = useDocument<Config>();
const publications = ref<Option[]>([]);
const researchFields = computed(() => resolveOptions(RESEARCH, { publications: publications.value }));

const loader = (file: string) => async () => {
  const { data, version } = await api<{ data: Config; version: string | null }>(`config/${file}`);
  return { value: data, version };
};
const publish = (doc: typeof home, file: string) =>
  doc.save(
    (data, version) => api<CommitResult>(`config/${file}`, { method: 'PUT', body: { data, version } }),
    `config/${file}.yml`,
  );

onMounted(() => {
  home.open('config/site#pages', loader('site'));
  research.open('config/research', loader('research'));
  api<Entry[]>('collections/publications').then((list) => {
    publications.value = list.map((p) => ({ value: p.slug, label: String(p.data.title ?? p.slug) }));
  }, report);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="pages" title="Pages" :dirty="home.dirty || research.dirty">
    <Tabs v-model:value="tab" class="pg">
      <div class="card card-flush pg-tabs">
        <TabList :pt="{ tabList: { 'aria-label': 'Pages' } }">
          <Tab value="pages"><i class="pi pi-sliders-h" aria-hidden="true" /> On/off</Tab>
          <Tab value="home"><i class="pi pi-home" aria-hidden="true" /> Home</Tab>
          <Tab value="research"><i class="pi pi-book" aria-hidden="true" /> Research</Tab>
        </TabList>
      </div>
      <TabPanels class="pg-panels">
        <TabPanel value="pages">
          <section class="card card-flush" aria-label="Pages on the site">
            <div class="card-head">
              <div>
                <h2 class="card-title">Pages on the site</h2>
                <p class="card-subtitle pg-note">
                  A page that is off leaves the menu, the footer and the sitemap, and its address shows Not found. Its
                  content stays, ready for when you turn it back on. Saved to config/site.yml.
                </p>
              </div>
            </div>
            <div class="pg-body">
              <DocBanners
                :draft="!!home.draft"
                :path="'config/site.yml'"
                :version="home.version"
                :conflict="home.conflict"
                :stale="home.draftStale ? home.draftChanges : null"
                @restore="home.restore()"
                @discard="home.discard()"
                @reload="home.reload()"
              />
              <div class="pg-switches">
                <FormFields v-if="home.current" :fields="SWITCHES" :model="home.current" :errors="home.errors" />
              </div>
            </div>
            <div class="pg-footer">
              <Button
                icon="pi pi-send"
                label="Publish pages"
                :disabled="home.saving"
                :pt="HIDE_ICON"
                @click="publish(home, 'site')"
              />
            </div>
          </section>
        </TabPanel>

        <TabPanel value="home">
          <section class="card card-flush" aria-label="Home page">
            <div class="card-head">
              <div>
                <h2 class="card-title">Home page</h2>
                <p class="card-subtitle pg-note">Saved to config/site.yml.</p>
              </div>
            </div>
            <div class="pg-body">
              <DocBanners
                :draft="!!home.draft"
                :path="'config/site.yml'"
                :version="home.version"
                :conflict="home.conflict"
                :stale="home.draftStale ? home.draftChanges : null"
                @restore="home.restore()"
                @discard="home.discard()"
                @reload="home.reload()"
              />
              <FormFields v-if="home.current" :fields="HOME" :model="home.current" :errors="home.errors" />
            </div>
            <div class="pg-footer">
              <Button
                icon="pi pi-send"
                label="Publish home page"
                :disabled="home.saving"
                :pt="HIDE_ICON"
                @click="publish(home, 'site')"
              />
            </div>
          </section>
        </TabPanel>

        <TabPanel value="research">
          <section class="card card-flush" aria-label="Research page">
            <div class="card-head">
              <div>
                <h2 class="card-title">Research page</h2>
                <p class="card-subtitle pg-note">Saved to config/research.yml.</p>
              </div>
            </div>
            <div class="pg-body">
              <DocBanners
                :draft="!!research.draft"
                :path="'config/research.yml'"
                :version="research.version"
                :conflict="research.conflict"
                :stale="research.draftStale ? research.draftChanges : null"
                @restore="research.restore()"
                @discard="research.discard()"
                @reload="research.reload()"
              />
              <FormFields
                v-if="research.current"
                :fields="researchFields"
                :model="research.current"
                :errors="research.errors"
              />
            </div>
            <div class="pg-footer">
              <Button
                icon="pi pi-send"
                label="Publish research page"
                :disabled="research.saving"
                :pt="HIDE_ICON"
                @click="publish(research, 'research')"
              />
            </div>
          </section>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </AdminShell>
</template>

<style scoped>
.pg-tabs {
  margin-block-end: 1.5rem;
}
.pg-tabs :deep(.p-tablist) {
  padding-inline: 0.75rem;
}
.pg-tabs :deep(.p-tablist-tab-list) {
  background: transparent;
}
.pg-tabs :deep(.p-tab) {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.125rem 0.875rem;
  font-size: 0.9375rem;
}
.pg-panels {
  padding: 0;
  background: transparent;
}
.pg .card-flush {
  overflow: visible;
}
.pg-note {
  max-width: 48rem;
  line-height: 1.5;
}
.pg-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
}
.pg-switches :deep(.ff) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.75rem;
}
.pg-switches :deep(.ff-check) {
  width: auto;
  padding: 0.875rem 1rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  font-weight: 500;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.pg-switches :deep(.ff-check:hover) {
  border-color: color-mix(in srgb, var(--p-primary-color) 40%, var(--app-border));
}
.pg-switches :deep(.ff-check:has(input:checked)) {
  border-color: color-mix(in srgb, var(--p-primary-color) 35%, var(--app-border));
  background: color-mix(in srgb, var(--p-primary-color) 5%, var(--app-card));
}
.pg-footer {
  position: sticky;
  inset-block-end: 0;
  z-index: 3;
  display: flex;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--app-border);
  border-end-start-radius: inherit;
  border-end-end-radius: inherit;
  background: color-mix(in srgb, var(--app-card) 94%, transparent);
  backdrop-filter: blur(6px);
}
@media (max-width: 575.98px) {
  .pg-body {
    padding: 1.25rem 1rem;
  }
  .pg-footer {
    padding-inline: 1rem;
  }
  .pg-tabs :deep(.p-tab) {
    padding-inline: 0.625rem;
  }
}
</style>
