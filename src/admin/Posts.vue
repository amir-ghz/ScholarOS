<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Skeleton from 'primevue/skeleton';
import AdminShell from './AdminShell.vue';
import { api, committed, report, toast } from './api';
import { formatDate } from './dates';
import type { AdminCtx, CommitResult, Entry } from './types';
import type { FeedItem } from '../lib/types';
import { postStatus, safeHref } from '../lib/utils';
import { HIDE_ICON } from './ui/content/pt';

/** A post status's chip colour. */
const CHIP: Record<string, string> = { Published: 'chip-success', Draft: 'chip-warning', Scheduled: 'chip-info' };
const status = (data: Entry['data']) => postStatus(data).replace(/ · .*/, '');

const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const posts = ref<Entry[]>([]);
const loading = ref(true);
const source = ref<'site' | 'imported'>(
  new URLSearchParams(location.search).get('source') === 'imported' ? 'imported' : 'site',
);
const imported = ref<{ items: FeedItem[]; hidden: string[]; error?: string } | null>(null);
const hidden = computed(() => new Set(imported.value?.hidden ?? []));

async function loadImported() {
  try {
    imported.value = await api<{ items: FeedItem[]; hidden: string[]; error?: string }>('feeds/hidden');
  } catch (e) {
    report(e);
  }
}

function show(next: 'site' | 'imported') {
  source.value = next;
  history.replaceState(null, '', next === 'imported' ? '?source=imported' : location.pathname);
}

/** Hiding is undoable from its toast instead of confirmed up front: it is one click to reverse, and nothing is lost. */
async function setHidden(item: FeedItem, hide: boolean) {
  try {
    const result = await api<CommitResult>('feeds/hidden', { method: 'PUT', body: { id: item.id, hidden: hide } });
    const ids = new Set(hidden.value);
    if (hide) ids.add(item.id);
    else ids.delete(item.id);
    imported.value = { ...imported.value!, hidden: [...ids] };
    if (hide)
      toast(`Hid “${item.title}” from the site`, result.url, { label: 'Undo', run: () => void setHidden(item, false) });
    else committed(result);
  } catch (e) {
    report(e);
  }
}

onMounted(async () => {
  void loadImported();
  try {
    posts.value = (await api<Entry[]>('collections/posts')).sort((a, b) =>
      String(b.data.date).localeCompare(String(a.data.date)),
    );
  } catch (e) {
    report(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="posts" title="Blog posts" narrow>
    <template #actions>
      <Button as="a" :href="`${base}/posts/new`" icon="pi pi-plus" label="New blog post" :pt="HIDE_ICON" />
    </template>
    <section class="card card-flush">
      <div class="card-head">
        <div class="po-seg" role="group" aria-label="Source">
          <button type="button" :aria-pressed="source === 'site'" @click="show('site')">
            <i class="pi pi-pencil" aria-hidden="true" />
            Written here <span class="po-count">{{ posts.length }}</span>
          </button>
          <button type="button" :aria-pressed="source === 'imported'" @click="show('imported')">
            <i class="pi pi-download" aria-hidden="true" />
            Imported from feeds <span class="po-count">{{ imported?.items.length ?? '' }}</span>
          </button>
        </div>
      </div>

      <template v-if="source === 'site'">
        <div v-if="loading" class="po-loading">
          <span class="adm-visually-hidden" role="status">Loading…</span>
          <Skeleton v-for="i in 4" :key="i" height="2.75rem" />
        </div>
        <template v-else-if="posts.length">
          <div class="po-cols" aria-hidden="true"><span>Title</span><span>Status</span><span>Date</span></div>
          <ul class="po-rows">
            <li v-for="p in posts" :key="p.slug">
              <span class="po-main">
                <span class="po-icon tint-primary" aria-hidden="true"><i class="pi pi-file-edit" /></span>
                <a class="po-title" dir="auto" :href="`${base}/posts/${p.slug}`">{{ p.data.title || p.slug }}</a>
              </span>
              <span class="po-status">
                <span :class="['chip', CHIP[status(p.data)] ?? 'chip-secondary']">{{ status(p.data) }}</span>
              </span>
              <time v-if="p.data.date" class="po-date" :datetime="String(p.data.date).slice(0, 10)">{{
                formatDate(String(p.data.date).slice(0, 10))
              }}</time>
            </li>
          </ul>
        </template>
        <div v-else class="empty-state">
          <i class="pi pi-pencil" aria-hidden="true" />
          <span>No posts yet. <a :href="`${base}/posts/new`">Start a blog post</a>.</span>
        </div>
      </template>

      <template v-else>
        <div v-if="!imported" class="po-loading">
          <span class="adm-visually-hidden" role="status">Loading…</span>
          <Skeleton v-for="i in 4" :key="i" height="2.75rem" />
        </div>
        <p v-else-if="imported.error" class="po-error" role="alert">
          <i class="pi pi-exclamation-circle" aria-hidden="true" /> {{ imported.error }}
        </p>
        <template v-else>
          <p class="card-subtitle po-intro">
            Posts pulled in from your feeds. Hide one to keep it off the site; the feed itself is unchanged.
          </p>
          <template v-if="imported.items.length">
            <div class="po-cols is-imported" aria-hidden="true">
              <span>Title</span><span>Status</span><span>Date</span><span />
            </div>
            <ul class="po-rows is-imported">
              <li v-for="f in imported.items" :key="f.id" :class="{ 'is-hidden': hidden.has(f.id) }">
                <span class="po-main">
                  <span class="po-icon tint-info" aria-hidden="true"><i class="pi pi-globe" /></span>
                  <span class="min-w-0">
                    <a class="po-title" dir="auto" :href="safeHref(f.link)" target="_blank" rel="noopener">{{
                      f.title
                    }}</a>
                    <span class="po-source">{{ f.source }}</span>
                  </span>
                </span>
                <span class="po-status">
                  <span :class="['chip', hidden.has(f.id) ? 'chip-secondary' : 'chip-success']">{{
                    hidden.has(f.id) ? 'Hidden' : 'Published'
                  }}</span>
                </span>
                <time class="po-date" :datetime="f.date">{{ formatDate(f.date) }}</time>
                <span class="po-action">
                  <Button
                    :icon="hidden.has(f.id) ? 'pi pi-eye' : 'pi pi-eye-slash'"
                    :label="hidden.has(f.id) ? 'Unhide' : 'Hide'"
                    size="small"
                    severity="secondary"
                    outlined
                    :aria-label="`${hidden.has(f.id) ? 'Unhide' : 'Hide'} ‘${f.title}’`"
                    :pt="HIDE_ICON"
                    @click="setHidden(f, !hidden.has(f.id))"
                  />
                </span>
              </li>
            </ul>
          </template>
          <div v-else class="empty-state">
            <i class="pi pi-globe" aria-hidden="true" />
            <span>
              Nothing imported yet. Add a feed in <a :href="`${base}/settings#feeds`">Settings</a>, then sync it from
              the <a :href="base">Dashboard</a>.
            </span>
          </div>
        </template>
      </template>
    </section>
  </AdminShell>
</template>

<style scoped>
.po-seg {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: 0.625rem;
  background: var(--app-canvas);
}
.po-seg button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0 1rem;
  border: 0;
  border-radius: 0.5rem;
  background: none;
  color: var(--app-body);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.po-seg button:hover {
  color: var(--app-heading);
}
.po-seg button[aria-pressed='true'] {
  background: var(--app-card);
  box-shadow: var(--app-shadow-card);
  color: var(--p-primary-color);
}
.po-seg .pi {
  font-size: 0.875rem;
}
.po-count {
  min-width: 1.5rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--c-secondary) 12%, transparent);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.po-count:empty {
  display: none;
}
.po-seg button[aria-pressed='true'] .po-count {
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
}
.po-loading {
  display: grid;
  gap: 0.75rem;
  padding: 1.5rem;
}
.po-intro {
  margin: 0;
  padding: 1rem 1.5rem 0.25rem;
  font-size: 0.875rem;
}
.po-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 1.5rem;
  padding: 0.875rem 1rem;
  border-inline-start: 4px solid var(--c-danger);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--c-danger) 8%, var(--app-card));
  color: var(--app-heading);
  font-size: 0.875rem;
}
/* Rows: Conca's table look (a tinted header row, roomy ruled rows) on a list. */
.po-cols,
.po-rows > li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 7.5rem 8rem;
  align-items: center;
  gap: 1rem;
  padding-inline: 1.5rem;
}
.po-cols.is-imported,
.po-rows.is-imported > li {
  grid-template-columns: minmax(0, 1fr) 7.5rem 8rem 6.5rem;
}
.po-cols {
  margin-block-start: 1rem;
  padding-block: 0.75rem;
  background: var(--app-canvas);
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.po-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.po-rows > li {
  padding-block: 0.875rem;
  transition: background 0.15s;
}
.po-rows > li + li {
  border-top: 1px solid var(--app-border);
}
.po-rows > li:hover {
  background: color-mix(in srgb, var(--app-menu-hover) 70%, transparent);
}
.po-main {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
}
.po-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  font-size: 1rem;
}
.adm a.po-title {
  display: block;
  overflow: hidden;
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adm a.po-title:hover {
  color: var(--p-primary-color);
  text-decoration: none;
}
.po-source {
  display: block;
  color: var(--app-muted);
  font-size: 0.75rem;
  font-weight: 500;
}
.po-rows > li.is-hidden .po-title {
  color: var(--app-muted);
}
.po-date {
  color: var(--app-body);
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}
.po-action {
  justify-self: end;
}
@media (max-width: 767.98px) {
  .po-cols {
    display: none;
  }
  .po-rows > li,
  .po-rows.is-imported > li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
    padding-inline: 1rem;
  }
  .po-main {
    flex: 1 0 100%;
  }
  .po-status {
    margin-inline-start: 3.375rem;
  }
  .po-action {
    margin-inline-start: auto;
  }
  .adm a.po-title {
    white-space: normal;
  }
  .po-intro {
    padding-inline: 1rem;
  }
  .po-seg button {
    padding: 0 0.75rem;
    font-size: 0.8125rem;
  }
}
</style>
