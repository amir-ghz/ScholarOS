<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import ProgressBar from 'primevue/progressbar';
import Skeleton from 'primevue/skeleton';
import AdminSections from './AdminSections.vue';
import AdminShell from './AdminShell.vue';
import FormFields from './FormFields.vue';
import ReadingNav from './ui/reading/ReadingNav.vue';
import { sourceTint } from './ui/reading/sources';
import { ApiError, api, report, toast } from './api';
import { text, type FieldDef } from './fields';
import { SOURCE_NAMES } from './reading';
import type { AdminCtx } from './types';
import type { ReadingPrefs } from '../lib/reading/settings';

type Keys = { OPENALEX_API_KEY: boolean; RESEND_API_KEY: boolean };
type Topic = { id: string; name: string; level: 'field' | 'subfield' };

const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const prefs = ref<ReadingPrefs | null>(null);
const keys = ref<Keys | null>(null);
// The reading room's AI calls so far today (UTC), against the saved cap.
const roomUse = ref({ today: 0, cap: 0 });
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const section = ref('');
const saved = ref('');
const dirty = computed(() => !!saved.value && JSON.stringify(prefs.value) !== saved.value);
// Suggestions filled in and not yet saved: the banner shows until Save.
const filled = ref(false);
const suggesting = ref(false);
const suggestError = ref('');

const list = (key: string, label: string, hint?: string): FieldDef => ({ key, label, type: 'list', hint });
const PROFILE_FIELDS: FieldDef[] = [
  { key: 'field', label: 'Field', type: 'textarea' },
  list('keywords', 'Keywords'),
  text('area', 'Wider area'),
];
const RXIV_HINT = "Lowercase words, '_' for spaces";
const SOURCES: { id: keyof ReadingPrefs['sources']; note?: string; fields?: FieldDef[] }[] = [
  { id: 'arxiv', fields: [list('sources.arxiv.categories', 'arXiv categories', 'Like cs.CL')] },
  { id: 'biorxiv', fields: [list('sources.biorxiv.categories', 'bioRxiv categories', RXIV_HINT)] },
  { id: 'medrxiv', fields: [list('sources.medrxiv.categories', 'medRxiv categories', RXIV_HINT)] },
  { id: 'pubmed', fields: [text('sources.pubmed.query', 'PubMed query')] },
  { id: 'openalex' },
  { id: 'huggingface', note: 'Machine learning only' },
  { id: 'bluesky' },
  { id: 'alphaxiv', note: 'Unofficial: no public API, it can break without notice' },
];
const DIGEST_FIELDS: FieldDef[] = [
  { key: 'talked', label: 'People are talking about: up to (0–20)', type: 'number' },
  { key: 'inField', label: 'New in your field: up to (0–30)', type: 'number' },
  { key: 'minScore', label: 'Minimum score for your field (0–100)', type: 'number' },
  { key: 'maxAiCalls', label: 'AI calls per night (1–100)', type: 'number' },
  { key: 'paused', label: 'Pause the nightly digest', type: 'checkbox' },
];
const ROOM_FIELDS: FieldDef[] = [
  {
    key: 'roomAiCalls',
    label: 'AI calls per day',
    type: 'number',
    hint: 'Summaries, study aids, chat turns, vault link suggestions and blog drafts in the reading room (1–1000). Resets at midnight UTC.',
  },
];
const EMAIL_FIELDS: FieldDef[] = [
  { key: 'email.on', label: 'Email me the digest each morning', type: 'checkbox' },
  { ...text('email.to', 'To'), hint: 'Empty sends it to the email on your CV.' },
  {
    ...text('email.from', 'From'),
    hint: 'onboarding@resend.dev only delivers to your Resend account’s email until you verify a domain.',
  },
];
// `fields`: the error-key prefixes each section owns, for its error dot.
const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: 'pi-user', fields: ['field', 'keywords', 'area'] },
  { id: 'sources', label: 'Sources', icon: 'pi-globe', fields: ['sources'] },
  {
    id: 'digest',
    label: 'Digest',
    icon: 'pi-sun',
    fields: ['talked', 'inField', 'minScore', 'maxAiCalls', 'paused', 'email'],
  },
  { id: 'room', label: 'Reading room', icon: 'pi-book', fields: ['roomAiCalls'] },
];

function loaded(s: { prefs: ReadingPrefs; keys: Keys; roomUse: number }) {
  prefs.value = s.prefs;
  keys.value = s.keys;
  roomUse.value = { today: s.roomUse, cap: s.prefs.roomAiCalls };
  saved.value = JSON.stringify(s.prefs);
}

/** Fills the profile and sources from the CV and research areas; nothing is saved until Save. */
async function suggest() {
  suggesting.value = true;
  try {
    const { prefs: s } = await api<{ prefs: ReadingPrefs }>('reading/suggest', { method: 'POST' });
    Object.assign(prefs.value!, { field: s.field, keywords: s.keywords, area: s.area, sources: s.sources });
    filled.value = true;
    suggestError.value = '';
  } catch (e) {
    suggestError.value = (e as Error).message;
  } finally {
    suggesting.value = false;
  }
}

// OpenAlex topics are picked by name; their ids are what the source reads.
const query = ref('');
const found = ref<Topic[] | null>(null);
const finding = ref(false);
const topicError = ref('');
async function findTopics() {
  finding.value = true;
  try {
    found.value = await api<Topic[]>(`reading/topics?q=${encodeURIComponent(query.value.trim())}`);
    topicError.value = '';
  } catch (e) {
    found.value = null;
    topicError.value = (e as Error).message;
  } finally {
    finding.value = false;
  }
}
const topics = () => prefs.value!.sources.openalex.topics;
function addTopic(t: Topic) {
  if (!topics().some((x) => x.id === t.id)) topics().push({ id: t.id, name: t.name });
}
const removeTopic = (id: string) => (prefs.value!.sources.openalex.topics = topics().filter((t) => t.id !== id));

async function save() {
  saving.value = true;
  errors.value = {};
  try {
    loaded(await api('reading/settings', { method: 'PUT', body: { prefs: prefs.value } }));
    filled.value = false;
    suggestError.value = '';
    toast('Saved');
  } catch (e) {
    if (e instanceof ApiError && e.status === 400 && e.details && typeof e.details === 'object')
      errors.value = e.details as Record<string, string>;
    report(e);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    loaded(await api('reading/settings'));
  } catch (e) {
    report(e);
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/settings" title="Reading settings" :dirty="dirty">
    <template #actions>
      <Button icon="pi pi-check" label="Save" :disabled="saving || !prefs" @click="save" />
    </template>
    <ReadingNav :base="base" current="settings" />

    <div v-if="!prefs" class="card" aria-hidden="true">
      <Skeleton v-for="n in 5" :key="n" height="2.5rem" class="mb-3" />
    </div>
    <template v-else>
      <p v-if="suggestError" class="rd-banner is-error" role="alert">
        <i class="pi pi-exclamation-circle" aria-hidden="true" />
        <span
          >{{ suggestError }} <a v-if="/ is not set/.test(suggestError)" :href="`${base}/ai#keys`">Add the key</a></span
        >
      </p>
      <p v-else-if="filled" class="rd-banner" role="status">
        <i class="pi pi-sparkles" aria-hidden="true" /> Suggested from your profile. Review and save.
      </p>
      <AdminSections v-model="section" :sections="SECTIONS" :errors="errors">
        <template #profile>
          <section class="card" aria-labelledby="rs-profile">
            <div class="card-head">
              <div class="rs-head">
                <span class="rs-icon tint-primary" aria-hidden="true"><i class="pi pi-user" /></span>
                <h2 id="rs-profile" class="card-title">Profile</h2>
              </div>
              <Button
                size="small"
                severity="secondary"
                outlined
                icon="pi pi-sparkles"
                :label="suggesting ? 'Suggesting…' : 'Suggest from my profile'"
                :disabled="suggesting"
                @click="suggest"
              />
            </div>
            <FormFields :fields="PROFILE_FIELDS" :model="prefs" :errors="errors" />
          </section>
        </template>

        <template #sources>
          <section class="card card-flush" aria-labelledby="rs-sources">
            <div class="card-head">
              <div class="rs-head">
                <span class="rs-icon tint-info" aria-hidden="true"><i class="pi pi-globe" /></span>
                <h2 id="rs-sources" class="card-title">Sources</h2>
              </div>
            </div>
            <div class="rs-sources">
              <div v-for="s in SOURCES" :key="s.id" class="rs-source" :class="{ 'is-on': prefs.sources[s.id].on }">
                <div class="rs-source-head">
                  <Checkbox v-model="prefs.sources[s.id].on" binary :input-id="`rs-src-${s.id}`" />
                  <span :class="['rs-source-badge', `tint-${sourceTint(s.id)}`]" aria-hidden="true">{{
                    SOURCE_NAMES[s.id].slice(0, 1)
                  }}</span>
                  <label :for="`rs-src-${s.id}`" class="rs-source-name">{{ SOURCE_NAMES[s.id] }}</label>
                </div>
                <small v-if="s.note" class="rs-note">{{ s.note }}</small>
                <div v-if="s.fields || s.id === 'openalex'" class="rs-source-body">
                  <FormFields v-if="s.fields" :fields="s.fields" :model="prefs" :errors="errors" />
                  <template v-if="s.id === 'openalex'">
                    <small v-if="keys && !keys.OPENALEX_API_KEY" class="rs-note is-warn" role="note"
                      ><i class="pi pi-info-circle" aria-hidden="true" /> Without a key, OpenAlex shares a small daily
                      budget with everyone on this server's address, which can run out on Vercel. Add OPENALEX_API_KEY
                      under <a :href="`${base}/ai#keys`">Integrations</a>.</small
                    >
                    <ul v-if="prefs.sources.openalex.topics.length" class="rs-topics" aria-label="OpenAlex topics">
                      <li v-for="t in prefs.sources.openalex.topics" :key="t.id" class="chip chip-primary">
                        {{ t.name }}
                        <button type="button" :aria-label="`Remove ${t.name}`" @click="removeTopic(t.id)">
                          <i class="pi pi-times" aria-hidden="true" />
                        </button>
                      </li>
                    </ul>
                    <form class="rs-find" @submit.prevent="findTopics">
                      <label for="adm-topic-q">Find an OpenAlex topic</label>
                      <div class="rs-find-row">
                        <InputText id="adm-topic-q" v-model="query" type="search" />
                        <Button
                          type="submit"
                          icon="pi pi-search"
                          label="Find"
                          severity="secondary"
                          outlined
                          :disabled="finding || query.trim().length < 2"
                        />
                      </div>
                    </form>
                    <span v-if="topicError" class="rs-error" role="alert">{{ topicError }}</span>
                    <p v-else-if="found && !found.length" class="rs-note" role="status">No topic matches.</p>
                    <div v-else-if="found" class="rs-found" role="group" aria-label="Matching topics">
                      <Button
                        v-for="t in found"
                        :key="t.id"
                        size="small"
                        severity="secondary"
                        outlined
                        :label="`+ ${t.name} (${t.level})`"
                        :disabled="prefs.sources.openalex.topics.some((x) => x.id === t.id)"
                        @click="addTopic(t)"
                      />
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </section>
        </template>

        <template #digest>
          <section class="card" aria-labelledby="rs-digest">
            <div class="card-head">
              <div class="rs-head">
                <span class="rs-icon tint-warning" aria-hidden="true"><i class="pi pi-sun" /></span>
                <h2 id="rs-digest" class="card-title">Digest</h2>
              </div>
            </div>
            <FormFields :fields="DIGEST_FIELDS" :model="prefs" :errors="errors" />
          </section>
          <section class="card" aria-labelledby="rs-email">
            <div class="card-head">
              <div class="rs-head">
                <span class="rs-icon tint-pink" aria-hidden="true"><i class="pi pi-envelope" /></span>
                <h2 id="rs-email" class="card-title">Email</h2>
              </div>
            </div>
            <p v-if="keys && !keys.RESEND_API_KEY" class="rd-banner rs-in-card" role="note">
              <i class="pi pi-info-circle" aria-hidden="true" />
              <span
                >Email uses the Resend key from
                <a :href="`${base}/career/settings#notifications`">Job search settings</a>.</span
              >
            </p>
            <FormFields :fields="EMAIL_FIELDS" :model="prefs" :errors="errors" />
          </section>
        </template>

        <template #room>
          <section class="card" aria-labelledby="rs-room">
            <div class="card-head">
              <div class="rs-head">
                <span class="rs-icon tint-success" aria-hidden="true"><i class="pi pi-book" /></span>
                <h2 id="rs-room" class="card-title">Reading room</h2>
              </div>
            </div>
            <FormFields :fields="ROOM_FIELDS" :model="prefs" :errors="errors" />
            <div class="rs-use">
              <p>Today: {{ roomUse.today }} of {{ roomUse.cap }}</p>
              <ProgressBar
                :value="roomUse.cap ? Math.min(100, Math.round((roomUse.today / roomUse.cap) * 100)) : 0"
                :show-value="false"
                class="rs-use-bar"
                aria-hidden="true"
              />
            </div>
          </section>
        </template>
      </AdminSections>
    </template>
  </AdminShell>
</template>

<style scoped>
.rd-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  margin: 0 0 1rem;
  padding: 0.875rem 1rem;
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--p-primary-color) 8%, var(--app-card));
  color: var(--app-heading);
  font-size: 0.875rem;
}
.rd-banner > .pi {
  margin-block-start: 0.2rem;
  color: var(--p-primary-color);
}
.rd-banner.is-error {
  background: color-mix(in srgb, var(--c-danger) 8%, var(--app-card));
  box-shadow: inset 4px 0 0 var(--c-danger);
}
.rd-banner.is-error > .pi {
  color: var(--c-danger);
}
.rs-in-card {
  margin-block-end: 1.25rem;
}
.rs-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.rs-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.5rem;
  font-size: 1rem;
}
.rs-sources {
  display: grid;
}
.rs-source {
  display: grid;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
}
.rs-source + .rs-source {
  border-top: 1px solid var(--app-border);
}
.rs-source-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.rs-source-badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 700;
}
.rs-source-name {
  flex: 1;
  color: var(--app-heading);
  font-weight: 600;
  cursor: pointer;
}
.rs-source:not(.is-on) .rs-source-name {
  color: var(--app-body);
  font-weight: 500;
}
.rs-note {
  display: block;
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rs-source > .rs-note {
  padding-inline-start: 5.125rem;
}
.rs-note.is-warn {
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--c-warning) 10%, transparent);
  color: var(--app-body);
}
.rs-source-body {
  display: grid;
  gap: 0.75rem;
  padding-inline-start: 5.125rem;
}
.rs-topics {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rs-topics .chip {
  padding-inline-end: 0.25rem;
  white-space: normal;
}
.rs-topics button {
  display: inline-grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
  cursor: pointer;
}
.rs-topics button:hover {
  background: color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}
.rs-topics button:focus-visible {
  outline: 2px solid var(--p-primary-color);
}
.rs-topics button .pi {
  font-size: 0.625rem;
}
.rs-find {
  display: grid;
  gap: 0.375rem;
  max-width: 32rem;
}
.rs-find label {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.rs-find-row {
  display: flex;
  gap: 0.5rem;
}
.rs-find-row :deep(.p-inputtext) {
  flex: 1;
  min-width: 0;
}
.rs-error {
  color: var(--c-danger);
  font-size: 0.8125rem;
}
.rs-found {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}
.rs-use {
  display: grid;
  gap: 0.5rem;
  max-width: 24rem;
  margin-block-start: 1.25rem;
  padding: 0.875rem 1rem;
  border-radius: 0.5rem;
  background: var(--app-canvas);
}
.rs-use p {
  margin: 0;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.rs-use-bar {
  height: 0.375rem;
}
@media (max-width: 575.98px) {
  .rs-source {
    padding-inline: 1rem;
  }
  .rs-source-body,
  .rs-source > .rs-note {
    padding-inline-start: 0;
  }
}
</style>
