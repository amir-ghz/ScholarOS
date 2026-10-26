<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import { api, report } from './api';
import { visibilityText } from './vault';
import type { AdminCtx } from './types';
import type { Visibility } from '../lib/reading/visibility';

// The Visibility line with its toggle, and the warning a write's failed republish leaves (with Publish again).
// `send` makes the note public or private; the line updates from its answer, and a failure leaves it as it was. A
// paper's toggle creates its note; a free note's needs the note (a notebook's, before it has one, has no toggle).
const props = defineProps<{
  ctx: AdminCtx;
  kind: 'paper' | 'free';
  shared?: { on: number; all: number };
  send: (on: boolean) => Promise<{ visibility: Visibility; publishWarning?: string }>;
}>();
const visibility = defineModel<Visibility | null>('visibility', { required: true });
const warning = defineModel<string>('warning', { required: true });

/** The line cut around its public address and the Pages link. */
const line = computed(() => {
  const v = visibility.value;
  if (!v) return null;
  const t = visibilityText(v, props.kind, props.shared);
  const url = v.url ?? '';
  const at = url ? t.indexOf(url) : t.length;
  const end = t.endsWith(' Pages.') ? t.length - 'Pages.'.length : t.length;
  return { head: t.slice(0, at), url, mid: t.slice(at + url.length, end), pages: end < t.length };
});

const busy = ref(false);
async function toggle() {
  busy.value = true;
  try {
    const res = await props.send(!visibility.value!.public);
    visibility.value = res.visibility;
    warning.value = res.publishWarning ?? '';
  } catch (e) {
    report(e);
  } finally {
    busy.value = false;
  }
}

const publishing = ref(false);
async function publishAgain() {
  publishing.value = true;
  try {
    warning.value =
      (await api<{ publishWarning?: string }>('reading/vault/publish', { body: {} })).publishWarning ?? '';
  } catch (e) {
    report(e);
  } finally {
    publishing.value = false;
  }
}
</script>

<template>
  <div v-if="line" class="rd-vis">
    <span :class="['rd-vis-icon', visibility!.public ? 'tint-success' : 'tint-secondary']" aria-hidden="true"
      ><i :class="['pi', visibility!.public ? 'pi-globe' : 'pi-lock']"
    /></span>
    <p class="rd-vis-text">
      {{ line.head }}<a v-if="line.url" :href="line.url" target="_blank" rel="noopener">{{ line.url }}</a
      >{{ line.mid }}<template v-if="line.pages"><a :href="`/${ctx.adminPath}/pages`">Pages</a>.</template>
    </p>
    <Button
      v-if="!visibility!.chat && (kind === 'paper' || visibility!.noteId)"
      size="small"
      severity="secondary"
      outlined
      :icon="visibility!.public ? 'pi pi-lock' : 'pi pi-globe'"
      :label="visibility!.public ? 'Make private' : 'Make public'"
      :disabled="busy"
      @click="toggle"
    />
  </div>
  <div v-if="warning" class="rd-vis rd-vis-warn" role="alert">
    <span class="rd-vis-icon tint-warning" aria-hidden="true"><i class="pi pi-exclamation-triangle" /></span>
    <p class="rd-vis-text">{{ warning }}</p>
    <Button size="small" label="Publish again" icon="pi pi-refresh" :disabled="publishing" @click="publishAgain" />
  </div>
</template>

<style scoped>
.rd-vis {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}
.rd-vis-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  font-size: 0.875rem;
}
.rd-vis-text {
  flex: 1 1 14rem;
  min-width: 0;
  margin: 0;
  color: var(--app-body);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.rd-vis-warn {
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--c-warning) 10%, transparent);
}
.rd-vis-warn .rd-vis-text {
  color: var(--app-heading);
}
</style>
