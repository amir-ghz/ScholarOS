<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- front matter is user data */
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import AdminShell from './AdminShell.vue';
import AiAssist from './AiAssist.vue';
import DocBanners from './DocBanners.vue';
import FormFields from './FormFields.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import { ApiError, api, report, toast } from './api';
import { resolveOptions, setIn, type FieldDef, type Option } from './fields';
import { useDocument } from './useDocument';
import { HIDE_ICON } from './ui/content/pt';
import type { AdminCtx, CommitResult, Entry } from './types';
import { postStatus, suggestSlug } from '../lib/utils';

type Post = { data: Record<string, any>; body: string };

const props = defineProps<{ ctx: AdminCtx; slug: string }>();
const isNew = ref(props.slug === 'new');
const slug = ref(isNew.value ? '' : props.slug);
const preview = ref(false);
const publications = ref<Option[]>([]);
const doc = useDocument<Post>();

const SIDEBAR: FieldDef[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'tags', label: 'Tags', type: 'list' },
  { key: 'relatedPublication', label: 'Related publication', type: 'select', optionsFrom: 'publications' },
  { key: 'excerpt', label: 'Summary', type: 'textarea', hint: 'Shown in post lists and link previews.' },
  { key: 'coverImage', label: 'Cover image', type: 'image', folder: 'content' },
  { key: 'featured', label: 'Show on home page', type: 'checkbox' },
  {
    key: 'medium.url',
    label: 'Medium URL',
    type: 'text',
    hint: 'Set by "Also publish to Medium", or paste the link after importing.',
  },
];
const sidebar = computed(() => resolveOptions(SIDEBAR, { publications: publications.value }));
/** A future date: "Publish" schedules the post. */
const scheduled = computed(() => postStatus({ date: doc.current?.data.date }).startsWith('Scheduled'));
const suggested = computed(() => suggestSlug(String(doc.current?.data.title ?? '')));

const loadPost = (target: string) => async () => {
  const entry = await api<Post & { version: string; readonly: boolean }>(`collections/posts/${target}`);
  return { value: { data: entry.data, body: entry.body }, version: entry.version, readonly: entry.readonly };
};

onMounted(async () => {
  await doc.open(
    `posts/${props.slug}`,
    isNew.value
      ? async () => ({
          value: { data: { title: '', date: new Date().toISOString().slice(0, 10), draft: true }, body: '' },
          version: null,
        })
      : loadPost(props.slug),
  );
  api<Entry[]>('collections/publications').then((list) => {
    publications.value = list.map((p) => ({ value: p.slug, label: String(p.data.title ?? p.slug) }));
  }, report);
});

const alsoMedium = ref(false);
const importReady = ref(false);
// Only an http(s) link is rendered as one: a stored `javascript:` URL would run on click.
const onMedium = computed(() => {
  const url = String(doc.current?.data.medium?.url ?? '');
  return /^https?:\/\//i.test(url) ? url : '';
});

async function sendToMedium() {
  const target = slug.value;
  try {
    const result = await api<CommitResult & { medium: { id: string; url: string } }>(`posts/${target}/medium`, {
      method: 'POST',
      body: { version: doc.version },
    });
    if (doc.current) doc.current.data.medium = result.medium;
    doc.version = result.versions[`src/content/posts/${target}.md`] ?? doc.version;
    await doc.settle(); // the link is committed, not an unsaved edit
    toast('Sent to Medium as a draft', result.medium.url);
  } catch (e) {
    const url = e instanceof ApiError ? (e.details as { url?: string } | undefined)?.url : undefined;
    if (e instanceof ApiError && e.status === 409 && url) {
      await doc.reload(); // it is already linked: show the stored link
      return toast('Already on Medium', url);
    }
    if (e instanceof ApiError && e.status === 502 && url) {
      return toast(`${e.message}`, url); // sent, but not recorded: no Retry (it would make a second draft)
    }
    toast(`Published; Medium cross-post failed: ${e instanceof Error ? e.message : String(e)}`, undefined, {
      label: 'Retry',
      run: () => void sendToMedium(),
    });
  }
}

/**
 * No token: Medium's import tool copies the post and sets the canonical link to the URL it was given, so that is the
 * site's public URL (siteUrl), not this admin's host (a *.vercel.app or preview URL).
 */
async function importToMedium() {
  const url = `${(props.ctx.siteUrl || location.origin).replace(/\/$/, '')}/blog/${slug.value}/`;
  const live = 'once the post is live (git mode: about a minute after publishing; a scheduled post: on its date)';
  try {
    await navigator.clipboard.writeText(url);
    toast(`Post URL copied: paste it into Medium’s import box ${live}, then paste the result into "Medium URL"`);
  } catch {
    toast(`Paste this URL into Medium’s import box ${live}: ${url}`);
  }
  window.open('https://medium.com/p/import', '_blank', 'noopener');
}

async function save(draft: boolean) {
  if (!doc.current) return;
  const target = isNew.value ? slug.value || suggested.value : slug.value;
  if (!/^[a-z0-9-]{1,80}$/.test(target)) {
    toast('The slug needs 1–80 lowercase letters, digits or dashes');
    return;
  }
  const path = `src/content/posts/${target}.md`;
  const result = await doc.save(
    (post, version) =>
      api<CommitResult>(`collections/posts/${target}`, {
        method: 'PUT',
        body: { data: { ...post.data, draft }, body: post.body, version },
      }),
    path,
  );
  if (!result || !doc.current) return;
  doc.current.data.draft = draft; // only once saved: a failed save or a conflict leaves the flag as it was
  await doc.settle(); // the flag change above is already committed, not an unsaved edit
  if (isNew.value) {
    isNew.value = false;
    slug.value = target;
    doc.retarget(`posts/${target}`, loadPost(target));
    history.replaceState(null, '', `/${props.ctx.adminPath}/posts/${target}`);
  }
  if (!draft && alsoMedium.value && !onMedium.value && !scheduled.value) {
    alsoMedium.value = false;
    if (props.ctx.mediumToken) await sendToMedium();
    else importReady.value = true;
  }
}

function setSubtitle(e: Event) {
  if (doc.current) setIn(doc.current.data, 'subtitle', (e.target as HTMLInputElement).value);
}
</script>

<template>
  <AdminShell :ctx="ctx" active="posts" :title="isNew ? 'New post' : 'Edit post'" :dirty="doc.dirty">
    <template #actions>
      <Button
        :icon="preview ? 'pi pi-pencil' : 'pi pi-eye'"
        :label="preview ? 'Edit' : 'Preview'"
        severity="secondary"
        outlined
        :aria-pressed="preview"
        :pt="HIDE_ICON"
        @click="preview = !preview"
      />
      <Button
        icon="pi pi-save"
        label="Save draft"
        severity="secondary"
        outlined
        :disabled="doc.saving || doc.readonly"
        :pt="HIDE_ICON"
        @click="save(true)"
      />
      <Button
        :icon="scheduled ? 'pi pi-calendar-clock' : 'pi pi-send'"
        :label="scheduled ? 'Schedule' : 'Publish'"
        :disabled="doc.saving || doc.readonly"
        :pt="HIDE_ICON"
        @click="save(false)"
      />
    </template>
    <div v-if="doc.current" class="pe">
      <DocBanners
        :draft="!!doc.draft"
        :path="isNew ? undefined : `src/content/posts/${slug}.md`"
        :version="doc.version"
        :conflict="doc.conflict"
        :stale="doc.draftStale ? doc.draftChanges : null"
        @restore="doc.restore()"
        @discard="doc.discard()"
        @reload="doc.reload()"
      />
      <p v-if="doc.readonly" class="pe-note">
        <i class="pi pi-lock" aria-hidden="true" />
        This post is MDX. The admin shows it read-only; edit it in the repository.
      </p>
      <div class="pe-grid">
        <div class="pe-main">
          <section class="card pe-writer">
            <input
              v-model="doc.current.data.title"
              class="pe-title"
              type="text"
              placeholder="Title"
              aria-label="Title"
              :readonly="doc.readonly"
            />
            <span v-if="doc.errors.title" class="pe-err">{{ doc.errors.title }}</span>
            <input
              :value="doc.current.data.subtitle ?? ''"
              class="pe-subtitle"
              type="text"
              placeholder="Subtitle"
              aria-label="Subtitle"
              :readonly="doc.readonly"
              @input="setSubtitle"
            />
            <pre v-if="doc.readonly" class="pe-pre">{{ doc.current.body }}</pre>
            <MarkdownEditor v-else v-model="doc.current.body" :preview="preview" />
          </section>
          <AiAssist
            v-if="!doc.readonly"
            collection="posts"
            :doc="doc.current"
            image-key="coverImage"
            @body="doc.current.body = $event"
          />
        </div>
        <aside class="pe-side" aria-label="Post settings">
          <section class="card">
            <h2 class="card-title pe-card-title">
              <i class="pi pi-sliders-h text-primary" aria-hidden="true" /> Post settings
            </h2>
            <label class="pe-field">
              <span>Slug (URL)</span>
              <InputText v-model="slug" :readonly="!isNew" :placeholder="suggested" fluid />
              <small v-if="slug || suggested || !doc.current.data.title">/blog/{{ slug || suggested }}</small>
              <small v-else
                >Type a slug: lowercase letters, digits or dashes. The title has none to suggest one from.</small
              >
            </label>
            <fieldset class="pe-fieldset" :disabled="doc.readonly">
              <FormFields :fields="sidebar" :model="doc.current.data" :errors="doc.errors" />
            </fieldset>
          </section>
          <section class="card pe-medium">
            <a v-if="onMedium" :href="onMedium" target="_blank" rel="noopener">Already on Medium ↗</a>
            <label v-else-if="!scheduled" class="pe-check">
              <Checkbox v-model="alsoMedium" binary :disabled="doc.readonly" />
              Also publish to Medium
            </label>
            <small v-else class="pe-muted">Medium cross-posting is available once the post is live.</small>
            <Button
              v-if="importReady && !onMedium"
              icon="pi pi-external-link"
              label="Import to Medium"
              severity="secondary"
              outlined
              size="small"
              :pt="HIDE_ICON"
              @click="importToMedium"
            />
          </section>
        </aside>
      </div>
    </div>
  </AdminShell>
</template>

<style scoped>
.pe {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.pe-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 340px);
  align-items: start;
  gap: 1.5rem;
}
@media (max-width: 1199.98px) {
  .pe-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.pe-main,
.pe-side {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  min-width: 0;
}
.pe-writer {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.pe-writer .pe-title {
  width: 100%;
  padding: 0.25rem 0;
  border: 0;
  border-radius: 0;
  outline: none;
  background: none;
  color: var(--app-heading);
  font-family: var(--font-sans);
  font-size: 1.875rem;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.25;
}
.pe-writer .pe-subtitle {
  width: 100%;
  margin-block-end: 1rem;
  padding: 0.25rem 0;
  border: 0;
  border-radius: 0;
  outline: none;
  background: none;
  color: var(--app-muted);
  font-size: 1.125rem;
}
.pe-writer :is(.pe-title, .pe-subtitle)::placeholder {
  color: var(--app-menu-heading);
}
.pe-writer :is(.pe-title, .pe-subtitle):focus-visible {
  box-shadow: inset 0 -2px 0 var(--p-primary-color);
}
.pe-err {
  color: var(--c-danger);
  font-size: 0.8125rem;
}
.pe-pre {
  margin: 0;
  padding: 1rem 1.25rem;
  border-radius: 0.625rem;
  background: var(--app-canvas);
  color: var(--app-heading);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  white-space: pre-wrap;
}
.pe-note {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin: 0;
  padding: 0.875rem 1rem;
  border: 1px solid color-mix(in srgb, var(--c-info) 30%, var(--app-border));
  border-inline-start: 4px solid var(--c-info);
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--c-info) 8%, var(--app-card));
  color: var(--app-heading);
  font-size: 0.875rem;
}
.pe-card-title {
  margin-block-end: 1.25rem;
}
.pe-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-block-end: 1.125rem;
}
.pe-field > span {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.pe-field small,
.pe-muted {
  color: var(--app-muted);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
.pe-field :deep(input.p-inputtext) {
  padding: var(--p-inputtext-padding-y) var(--p-inputtext-padding-x);
  border-color: var(--p-inputtext-border-color);
  font-size: 0.9375rem;
}
.pe-field :deep(input.p-inputtext:enabled:focus) {
  border-color: var(--p-inputtext-focus-border-color);
}
.pe-field :deep(input.p-inputtext[readonly]) {
  background: var(--p-inputtext-disabled-background);
  color: var(--app-body);
}
.pe-fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.pe-medium {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
  padding-block: 1.125rem;
}
.pe-check {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  cursor: pointer;
}
</style>
