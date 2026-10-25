<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Skeleton from 'primevue/skeleton';
import { api, committed, report, toast } from './api';
import type { CommitResult, MediaFile } from './types';
import { HIDE_ICON } from './ui/content/pt';

const props = defineProps<{ folder: 'content' | 'site'; pickable?: boolean }>();
const emit = defineEmits<{ pick: [url: string] }>();
const files = ref<MediaFile[]>([]);
const loading = ref(true);
const busy = ref(false);
const over = ref(false);
const confirming = ref<string | null>(null);
// Content images are processed at build time and have no URL in production; only `astro dev` serves them.
const showPreview = props.folder === 'site' || import.meta.env.DEV;
const fileName = (f: MediaFile) => f.path.slice(f.path.lastIndexOf('/') + 1);

onMounted(async () => {
  try {
    files.value = await api<MediaFile[]>(`media?folder=${props.folder}`);
  } catch (e) {
    report(e);
  } finally {
    loading.value = false;
  }
});

async function upload(list: FileList | null | undefined) {
  if (!list?.length) return;
  busy.value = true;
  for (const file of [...list]) {
    const form = new FormData();
    form.append('file', file);
    form.append('folder', props.folder);
    try {
      const uploaded = await api<MediaFile & { commit: Pick<CommitResult, 'id' | 'url'> | null }>('media', { form });
      if (uploaded.commit) committed(uploaded.commit);
      else toast(`${fileName(uploaded)} is already in the library`);
      files.value = [uploaded, ...files.value.filter((f) => f.path !== uploaded.path)];
    } catch (e) {
      report(e);
    }
  }
  busy.value = false;
}

async function remove(f: MediaFile) {
  if (confirming.value !== f.path) {
    confirming.value = f.path;
    return;
  }
  confirming.value = null;
  try {
    committed(await api<CommitResult>('media', { method: 'DELETE', body: { path: f.path, version: f.version } }));
    files.value = files.value.filter((x) => x.path !== f.path);
  } catch (e) {
    report(e);
  }
}

function copy(f: MediaFile) {
  navigator.clipboard.writeText(f.url).then(
    () => toast(`Copied ${f.url}`),
    () => toast(f.url),
  );
}

async function pickFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  await upload(input.files);
  input.value = ''; // choosing the same file again fires `change` again
}

function drop(e: DragEvent) {
  over.value = false;
  upload(e.dataTransfer?.files);
}
</script>

<template>
  <div class="mg">
    <label
      class="mg-drop"
      :class="{ 'is-over': over, 'is-busy': busy }"
      @dragover.prevent="over = true"
      @dragleave="over = false"
      @drop.prevent="drop"
    >
      <span class="stat-icon tint-primary mg-drop-icon" aria-hidden="true">
        <i :class="['pi', busy ? 'pi-spin pi-spinner' : 'pi-cloud-upload']" />
      </span>
      <span class="mg-drop-text">{{
        busy ? 'Uploading…' : 'Drop images here or click to choose (PNG, JPEG, WebP, GIF, AVIF, SVG, ICO; up to 4 MB)'
      }}</span>
      <input
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,image/x-icon,.ico"
        class="adm-visually-hidden"
        aria-label="Upload images"
        @change="pickFiles"
      />
    </label>
    <p v-if="loading" class="adm-visually-hidden" role="status">Loading…</p>
    <div v-if="loading" class="mg-grid" aria-hidden="true">
      <Skeleton v-for="i in 4" :key="i" height="13rem" border-radius="0.625rem" />
    </div>
    <div v-else-if="!files.length" class="empty-state">
      <i class="pi pi-images" aria-hidden="true" />
      <span>No images yet.</span>
    </div>
    <div class="mg-grid">
      <figure v-for="f in files" :key="f.path" class="mg-tile" :class="{ 'is-confirming': confirming === f.path }">
        <div class="mg-thumb">
          <img v-if="showPreview" :src="f.url" :alt="fileName(f)" loading="lazy" />
          <span v-else class="mg-ext" aria-hidden="true">{{ fileName(f).split('.').pop()?.toUpperCase() }}</span>
        </div>
        <figcaption :title="fileName(f)">{{ fileName(f) }}</figcaption>
        <div class="mg-actions">
          <Button
            v-if="pickable"
            label="Use"
            size="small"
            icon="pi pi-check"
            :pt="HIDE_ICON"
            @click="emit('pick', f.url)"
          />
          <Button
            label="Copy path"
            icon="pi pi-copy"
            size="small"
            severity="secondary"
            text
            :pt="HIDE_ICON"
            @click="copy(f)"
          />
          <Button
            :label="confirming === f.path ? 'Confirm delete' : 'Delete'"
            icon="pi pi-trash"
            size="small"
            severity="danger"
            :text="confirming !== f.path"
            :pt="HIDE_ICON"
            @click="remove(f)"
          />
        </div>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.mg {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-width: 0;
}
.mg-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 1.75rem 1.25rem;
  border: 2px dashed color-mix(in srgb, var(--p-primary-color) 30%, var(--app-border));
  border-radius: var(--app-radius-card);
  background: color-mix(in srgb, var(--p-primary-color) 3%, var(--app-card));
  color: var(--app-body);
  font-size: 0.875rem;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.mg-drop:hover,
.mg-drop.is-over {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 7%, var(--app-card));
}
.mg-drop.is-over {
  color: var(--p-primary-color);
}
.mg-drop:focus-within {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}
.mg-drop-icon {
  margin-block-end: 0.5rem;
}
.mg-drop-text {
  max-width: 34rem;
}
.mg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}
@media (max-width: 575.98px) {
  .mg-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.75rem;
  }
}
.mg-tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  background: var(--app-card);
  transition:
    box-shadow 0.15s,
    border-color 0.15s;
}
.mg-tile:hover {
  box-shadow: var(--app-shadow-float);
}
.mg-tile.is-confirming {
  border-color: color-mix(in srgb, var(--c-danger) 45%, var(--app-border));
}
.mg-thumb {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  /* Light in both themes: most images are drawn for the light public site, and transparent line art would vanish. */
  background: repeating-conic-gradient(#f1f1f4 0% 25%, #fafafb 0% 50%) 50% / 16px 16px;
}
.mg-thumb img {
  position: absolute;
  inset: 0.5rem;
  width: calc(100% - 1rem);
  height: calc(100% - 1rem);
  object-fit: contain;
}
.mg-ext {
  color: var(--app-muted);
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.mg-tile figcaption {
  padding: 0.625rem 0.75rem 0;
  overflow: hidden;
  color: var(--app-heading);
  font-size: 0.8125rem;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mg-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.25rem;
  margin-block-start: auto;
  padding: 0.375rem 0.375rem 0.5rem;
}
.mg-actions :deep(.p-button) {
  gap: 0.375rem;
  padding-inline: 0.5rem;
  font-size: 0.8125rem;
}
</style>
