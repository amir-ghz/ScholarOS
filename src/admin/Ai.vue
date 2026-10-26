<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- config files are user data */
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Skeleton from 'primevue/skeleton';
import Textarea from 'primevue/textarea';
import AdminSections from './AdminSections.vue';
import AdminShell from './AdminShell.vue';
import DocBanners from './DocBanners.vue';
import FormFields from './FormFields.vue';
import { api, report, toast } from './api';
import { text, type FieldDef } from './fields';
import { CAREER_KEY_HELP } from './career';
import { useDocument } from './useDocument';
import type { AdminCtx, CommitResult } from './types';
import { DEFAULT_MODELS, IMAGE_PROVIDERS, TEXT_PROVIDERS, resolveAiConfig, scheduleLabel } from '../lib/ai/providers';
import type { PapersResult } from '../lib/admin/papers';
import type { SecretStatus } from '../lib/admin/secrets';

type Config = Record<string, any>;
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const editable = props.ctx.mode === 'postgres';
// Job-source keys are the owner's, and only exist where the job search does.
const jobKeys = editable && props.ctx.isOwner;

const keys = ref<SecretStatus[]>([]);
const typed = ref<Record<string, string>>({});
const savingKey = ref('');
/** Each key's save endpoint: the job-source keys have their own, owner-only one. */
const endpoint = new Map<string, string>();
const section = ref('');
const ai = useDocument<Config>();
const scholar = useDocument<Config>();
const checking = ref(false);
const checked = ref<PapersResult | null>(null);
const lastRun = ref<string | null>(null);

const schedule = computed(() => {
  const s = resolveAiConfig(ai.current).papers.schedule;
  return s.every === 'off' ? 'never' : s.every === 'day' ? 'daily' : scheduleLabel(s);
});
const options = (providers: Record<string, { label: string }>) =>
  Object.entries(providers).map(([value, p]) => ({ value, label: p.label }));
const AI_FIELDS = computed<FieldDef[]>(() => {
  const effective = resolveAiConfig(ai.current);
  return [
    { key: 'text.provider', label: 'Writing provider', type: 'select', options: options(TEXT_PROVIDERS) },
    {
      key: 'text.model',
      label: 'Writing model',
      type: 'text',
      hint: `Empty uses ${DEFAULT_MODELS.text[effective.text.provider]}.`,
    },
    { key: 'image.provider', label: 'Image provider', type: 'select', options: options(IMAGE_PROVIDERS) },
    {
      key: 'image.model',
      label: 'Image model',
      type: 'text',
      hint: `Empty uses ${DEFAULT_MODELS.image[effective.image.provider]}.`,
    },
    {
      key: 'video.model',
      label: 'Animation model (Higgsfield)',
      type: 'text',
      hint: `Generate GIF animates a Higgsfield still with this image-to-video model. Empty uses ${DEFAULT_MODELS.video.higgsfield}.`,
    },
    {
      key: 'papers.schedule.every',
      label: 'Check for new papers',
      type: 'select',
      options: [
        { value: 'off', label: 'Never (Check now only)' },
        { value: 'day', label: 'Every day' },
        { value: 'week', label: 'Every week' },
        { value: 'month', label: 'Every month' },
      ],
      hint: 'The daily run skips on other days. Empty means every day. UTC.',
    },
    ...(effective.papers.schedule.every === 'week'
      ? [{ key: 'papers.schedule.weekday', label: 'Weekday (0 Sunday … 6 Saturday)', type: 'number' as const }]
      : []),
    ...(effective.papers.schedule.every === 'month'
      ? [{ key: 'papers.schedule.monthday', label: 'Day of the month (1–28)', type: 'number' as const }]
      : []),
    { key: 'papers.autoPost', label: 'Write a draft post for each new paper', type: 'checkbox', default: true },
    {
      key: 'papers.maxPostsPerRun',
      label: 'Posts per run',
      type: 'number',
      hint: 'Each post costs a writing and an image call. More new papers wait for the next run.',
    },
  ];
});
const SCHOLAR_FIELDS: FieldDef[] = [
  {
    key: 'authors',
    label: 'Google Scholar authors',
    type: 'objects',
    fields: [text('name', 'Name'), text('scholar_id', 'Scholar author id (the user= value in the profile URL)')],
  },
];

const SECTIONS = computed(() => [
  { id: 'keys', label: 'Keys', icon: 'pi-key' },
  {
    id: 'writing',
    label: 'Writing & images',
    icon: 'pi-sparkles',
    fields: AI_FIELDS.value.map((f) => f.key.split('.')[0]),
  },
  { id: 'scholar', label: 'Google Scholar', icon: 'pi-google', fields: ['authors'] },
]);
/** Each key card's icon and tint, by the provider its name starts with. */
const LOOKS: [RegExp, string, string][] = [
  [/^(OPENAI|CODEX)/, 'pi-sparkles', 'success'],
  [/^(ANTHROPIC|CLAUDE)/, 'pi-sparkles', 'warning'],
  [/^GEMINI/, 'pi-google', 'info'],
  [/^HIGGSFIELD/, 'pi-image', 'pink'],
  [/^SERPAPI/, 'pi-search', 'primary'],
  [/^OPENALEX/, 'pi-book', 'info'],
  [/^(ADZUNA|USAJOBS)/, 'pi-briefcase', 'secondary'],
  [/^RESEND/, 'pi-envelope', 'primary'],
];
const look = (name: string) => LOOKS.find(([re]) => re.test(name)) ?? [null, 'pi-key', 'secondary'];
const errors = computed(() => ({ ...ai.errors, ...scholar.errors }));

function status(k: SecretStatus): string {
  if (k.source === 'admin') return `Set in admin · …${k.last4}`;
  if (k.source === 'env') return 'From environment';
  return 'Not set';
}

/** One list: the AI and Scholar keys, then the job-source ones (SerpApi, which both use, once). */
async function loadKeys() {
  const [aiKeys, jobs] = await Promise.allSettled([
    api<SecretStatus[]>('ai/keys'),
    jobKeys ? api<SecretStatus[]>('career/keys') : Promise.resolve([]),
  ]);
  for (const [r, path] of [
    [aiKeys, 'ai/keys'],
    [jobs, 'career/keys'],
  ] as const) {
    if (r.status === 'rejected') report(r.reason);
    else
      for (const k of r.value.filter((k) => !endpoint.has(k.name))) {
        endpoint.set(k.name, path);
        keys.value.push(k);
      }
  }
}

async function saveKey(name: string, value: string | null) {
  savingKey.value = name;
  try {
    const fresh = await api<SecretStatus[]>(endpoint.get(name)!, { method: 'PUT', body: { name, value } });
    keys.value = keys.value.map((k) => fresh.find((f) => f.name === k.name) ?? k);
    typed.value[name] = '';
    toast(value ? 'Key saved' : 'Key cleared');
  } catch (e) {
    report(e);
  } finally {
    savingKey.value = '';
  }
}

const loader = (file: string) => async () => {
  const { data, version } = await api<{ data: Config; version: string | null }>(`config/${file}`);
  return { value: data, version };
};
const publish = (doc: typeof ai, file: string) =>
  doc.save(
    (data, version) => api<CommitResult>(`config/${file}`, { method: 'PUT', body: { data, version } }),
    `config/${file}.yml`,
  );

async function checkNow() {
  checking.value = true;
  try {
    checked.value = await api<PapersResult>('papers/sync', { method: 'POST' });
    if (checked.value.skipped) toast(`Nothing checked: ${checked.value.skipped}`);
    lastRun.value = (await api<{ lastRun: string | null }>('papers/sync')).lastRun;
  } catch (e) {
    report(e);
  } finally {
    checking.value = false;
  }
}

onMounted(() => {
  loadKeys();
  ai.open('config/ai', loader('ai'));
  scholar.open('config/scholar', loader('scholar'));
  api<{ lastRun: string | null }>('papers/sync').then((r) => (lastRun.value = r.lastRun), report);
});
</script>

<template>
  <AdminShell :ctx="ctx" active="ai" title="Integrations" :dirty="ai.dirty || scholar.dirty">
    <template #actions>
      <Button
        v-if="section === 'writing'"
        icon="pi pi-check"
        label="Publish AI settings"
        :disabled="ai.saving || !ai.current"
        @click="publish(ai, 'ai')"
      />
      <Button
        v-if="section === 'scholar'"
        icon="pi pi-check"
        label="Publish authors"
        :disabled="scholar.saving || !scholar.current"
        @click="publish(scholar, 'scholar')"
      />
    </template>
    <AdminSections v-model="section" :sections="SECTIONS" :errors="errors">
      <template #keys>
        <div class="card int-intro">
          <span class="int-icon tint-primary" aria-hidden="true"><i class="pi pi-key" /></span>
          <p>
            <template v-if="editable">
              Keys typed here are stored encrypted in the database. Without one, the environment variable of the same
              name is used.
            </template>
            <template v-else>
              Git mode has no database: set each key as an environment variable in Vercel (Settings → Environment
              Variables), then redeploy.
            </template>
          </p>
        </div>
        <ul class="int-keys">
          <li v-for="k in keys" :key="k.name" class="card int-key">
            <div class="int-key-head">
              <span :class="['int-icon', `tint-${look(k.name)[2]}`]" aria-hidden="true"
                ><i :class="['pi', look(k.name)[1]]"
              /></span>
              <span class="int-key-name">
                <span class="int-key-label">{{ k.label }}</span>
                <code>{{ k.name }}</code>
              </span>
              <span :class="['chip', !k.source ? 'chip-secondary' : 'chip-success']">
                <i
                  :class="['pi', !k.source ? 'pi-circle' : 'pi-check-circle']"
                  class="int-chip-icon"
                  aria-hidden="true"
                />{{ !k.source ? 'Not set' : 'Connected' }}</span
              >
            </div>
            <p v-if="k.source" class="int-status">{{ status(k) }}</p>
            <p v-if="CAREER_KEY_HELP[k.name]" class="int-help">{{ CAREER_KEY_HELP[k.name] }}</p>
            <p v-if="k.undecryptable" class="int-err">
              The stored key can’t be decrypted (SESSION_SECRET changed): enter it again.
            </p>
            <form v-if="editable" class="int-form" @submit.prevent="saveKey(k.name, typed[k.name] ?? '')">
              <Textarea
                v-if="k.name === 'CODEX_AUTH_JSON'"
                v-model="typed[k.name]"
                rows="3"
                autocomplete="off"
                spellcheck="false"
                :aria-label="`New ${k.label}`"
                placeholder="Paste the file’s contents"
                fluid
              />
              <InputText
                v-else
                v-model="typed[k.name]"
                type="password"
                autocomplete="off"
                :aria-label="`New ${k.label} key`"
                placeholder="Paste a new key"
                fluid
              />
              <div class="int-form-actions">
                <Button type="submit" label="Save" size="small" :disabled="savingKey === k.name || !typed[k.name]" />
                <Button
                  v-if="k.source === 'admin' || k.undecryptable"
                  label="Clear"
                  size="small"
                  severity="secondary"
                  outlined
                  :disabled="savingKey === k.name"
                  @click="saveKey(k.name, null)"
                />
              </div>
            </form>
          </li>
        </ul>
      </template>

      <template #writing>
        <DocBanners
          :draft="!!ai.draft"
          :path="'config/ai.yml'"
          :version="ai.version"
          :conflict="ai.conflict"
          :stale="ai.draftStale ? ai.draftChanges : null"
          @restore="ai.restore()"
          @discard="ai.discard()"
          @reload="ai.reload()"
        />
        <section class="card" aria-labelledby="int-writing">
          <div class="card-head int-head">
            <span class="int-icon tint-primary" aria-hidden="true"><i class="pi pi-sparkles" /></span>
            <div>
              <h2 id="int-writing" class="card-title">Writing &amp; images</h2>
              <p class="card-subtitle">
                Write, Rewrite and Generate image in the post and news editors send the title, subtitle, summary,
                instruction and body to the provider chosen here; for a publication, Generate image sends its title and
                abstract. Generate GIF always uses Higgsfield. Saved to config/ai.yml.
              </p>
            </div>
          </div>
          <FormFields v-if="ai.current" :fields="AI_FIELDS" :model="ai.current" :errors="ai.errors" />
          <Skeleton v-else height="12rem" />
        </section>
      </template>

      <template #scholar>
        <DocBanners
          :draft="!!scholar.draft"
          :path="'config/scholar.yml'"
          :version="scholar.version"
          :conflict="scholar.conflict"
          :stale="scholar.draftStale ? scholar.draftChanges : null"
          @restore="scholar.restore()"
          @discard="scholar.discard()"
          @reload="scholar.reload()"
        />
        <section class="card" aria-labelledby="int-scholar">
          <div class="card-head int-head">
            <span class="int-icon tint-info" aria-hidden="true"><i class="pi pi-google" /></span>
            <div>
              <h2 id="int-scholar" class="card-title">Google Scholar</h2>
              <p class="card-subtitle">
                New papers on these profiles (through SerpApi) become publications and, per Writing &amp; images, draft
                posts to review.
                {{
                  editable
                    ? `Checked ${schedule}, or now:`
                    : `Check now, or let the GitHub Action sync them (${schedule}).`
                }}
              </p>
            </div>
          </div>
          <FormFields
            v-if="scholar.current"
            :fields="SCHOLAR_FIELDS"
            :model="scholar.current"
            :errors="scholar.errors"
          />
          <Skeleton v-else height="8rem" />
          <div class="int-check">
            <Button
              icon="pi pi-refresh"
              :label="checking ? 'Checking…' : 'Check now'"
              severity="secondary"
              outlined
              :loading="checking"
              @click="checkNow"
            />
            <span class="int-muted"
              >Last new papers: {{ lastRun ? new Date(lastRun).toLocaleString() : 'none yet' }}</span
            >
          </div>
        </section>
        <section v-if="checked && !checked.skipped" class="card int-result" role="status">
          <p class="int-result-line">
            <span class="int-icon tint-success" aria-hidden="true"><i class="pi pi-check" /></span>
            <span>
              Imported {{ checked.imported.length }} · drafted {{ checked.posts.length }}
              <template v-if="checked.deferred.length"> · {{ checked.deferred.length }} left for the next run</template>
              <template v-if="checked.failed.length"> · {{ checked.failed.length }} failed</template>
            </span>
          </p>
          <ul v-if="checked.posts.length" class="int-list">
            <li v-for="slug in checked.posts" :key="slug" class="list-row">
              <span
                ><a :href="`${base}/posts/${slug}`" class="list-row-title">{{ slug }}</a> (draft)</span
              >
            </li>
          </ul>
          <ul v-if="checked.failed.length" class="int-list">
            <li v-for="f in checked.failed" :key="f.item" class="list-row int-err">{{ f.item }}: {{ f.error }}</li>
          </ul>
        </section>
      </template>
    </AdminSections>
  </AdminShell>
</template>

<style scoped>
.int-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  font-size: 1.05rem;
}
.int-intro {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-block: 1rem;
}
.int-intro p {
  margin: 0;
  color: var(--app-body);
  font-size: 0.875rem;
}
.int-head {
  flex-wrap: nowrap;
  align-items: flex-start;
  justify-content: flex-start;
  margin-block-end: 1.5rem;
}
.int-keys {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.int-key {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.25rem;
}
.int-key-head {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}
.int-key-name {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.int-key-label {
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.35;
}
.int-key-name code {
  overflow: hidden;
  color: var(--app-muted);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.int-chip-icon {
  font-size: 0.7rem;
}
.int-status,
.int-help,
.int-err {
  margin: 0;
  font-size: 0.8125rem;
}
.int-status {
  color: var(--app-heading);
  font-weight: 500;
}
.int-help {
  color: var(--app-muted);
}
.int-err {
  color: var(--c-danger);
}
.int-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-block-start: auto;
}
.int-form-actions {
  display: flex;
  gap: 0.5rem;
}
.int-check {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  margin-block-start: 1.5rem;
  padding-block-start: 1.25rem;
  border-top: 1px dashed var(--app-border);
}
.int-muted {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.int-result-line {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0;
  color: var(--app-heading);
  font-weight: 500;
}
.int-list {
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}
a.list-row-title {
  text-decoration: none;
}
</style>
