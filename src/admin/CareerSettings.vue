<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Skeleton from 'primevue/skeleton';
import AdminSections from './AdminSections.vue';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import FormFields from './FormFields.vue';
import { ApiError, api, report, session, toast } from './api';
import { text, type FieldDef } from './fields';
import { LIMIT_FIELDS, STAGES, WORKER_KEYS, WORKERS, type WorkerChoice } from './career';
import { detectAts } from '../lib/career/sources/detect';
import type { ApplicationAnswers, CareerPrefs } from '../lib/career/settings';
import type { AdminCtx } from './types';
import type { CvConfig, CvStylesConfig } from '../lib/types';
import type { SecretName, SecretStatus } from '../lib/admin/secrets';

interface SourceInfo {
  id: string;
  label: string;
  needs: string[];
  defaultOn: boolean;
  warning: string | null;
}
type Floor = { amount?: number; currency?: string; period?: string };

const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const prefs = ref<CareerPrefs | null>(null);
const answers = ref<ApplicationAnswers | null>(null);
const floor = ref<Floor>({});
const sources = ref<SourceInfo[]>([]);
const suggested = ref<{ label: string; url: string }[]>([]);
const styles = ref<{ id: string; name: string }[]>([]);
/** The CV style select's options: the public style ('') first. */
const styleOptions = computed(() => [{ id: '', name: 'Public style' }, ...styles.value]);
const saving = ref(false);
const errors = ref<Record<string, string>>({});
// Suggestions filled in and not yet saved: the banner shows until Save.
const filled = ref(false);
const section = ref('');
// What was loaded or last saved, to tell whether the form has unsaved changes.
const snapshot = () => JSON.stringify([prefs.value, answers.value, floor.value]);
const saved = ref('');
const dirty = computed(() => !!saved.value && snapshot() !== saved.value);
const suggestError = ref('');
const suggesting = ref(false);

// Per-source settings the source reads from `prefs.sources[id].options`.
const SOURCE_OPTIONS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  adzuna: [{ key: 'country', label: 'Country code', placeholder: 'us' }],
  usajobs: [{ key: 'email', label: 'Contact email', placeholder: 'you@example.org' }],
};

const strings = (key: string, label: string, hint?: string): FieldDef => ({ key, label, type: 'list', hint });
const WANT_FIELDS: FieldDef[] = [
  strings('roles', 'Roles'),
  strings('keywords', 'Keywords'),
  strings('seniority', 'Seniority'),
  strings('locations', 'Locations', "Postings outside these places that aren't remote are filtered out."),
  {
    key: 'remote',
    label: 'Remote',
    type: 'select',
    options: ['any', 'remote', 'hybrid', 'onsite'],
  },
  {
    key: 'languages',
    label: 'Languages',
    type: 'objects',
    fields: [text('language', 'Language'), text('level', 'Level')],
  },
  strings('fields', 'Fields'),
  strings('mustHaves', 'Must have'),
  strings('dealBreakers', 'Deal breakers'),
  strings('avoidCompanies', 'Avoid companies'),
  {
    key: 'threshold',
    label: 'Match threshold (0–100)',
    type: 'number',
    hint: 'Postings scored at or above this show as matches.',
  },
  {
    key: 'maxScoresPerRun',
    label: 'Scores per run',
    type: 'number',
    hint: 'Per run: each score is one AI call, up to three when a reply is malformed. The rest wait for the next run.',
  },
];
const FLOOR_FIELDS: FieldDef[] = [
  { key: 'amount', label: 'Salary floor', type: 'number', hint: 'Empty means no floor.' },
  text('currency', 'Currency (e.g. USD)'),
  { key: 'period', label: 'Per', type: 'select', options: ['year', 'month', 'hour'] },
];
const WATCHED_FIELDS: FieldDef[] = [strings('watched', 'Careers page or job board URLs')];
const FEED_FIELDS: FieldDef[] = [strings('feeds', 'RSS or Atom feed URLs')];
const ANSWER_FIELDS: FieldDef[] = [
  text('workAuthorization', 'Work authorization'),
  { key: 'sponsorship', label: 'Needs visa sponsorship', type: 'select', options: ['', 'yes', 'no'] },
  text('noticePeriod', 'Notice period'),
  text('earliestStart', 'Earliest start'),
  text('salaryExpectation', 'Salary expectation'),
  text('phone', 'Phone'),
  { key: 'address', label: 'Address', type: 'textarea' },
  {
    key: 'links',
    label: 'Links',
    type: 'objects',
    fields: [text('label', 'Label'), text('url', 'URL')],
  },
  { key: 'whyLooking', label: 'Why I am looking', type: 'textarea' },
  {
    key: 'eeo.mode',
    label: 'Voluntary self-identification questions',
    type: 'select',
    options: [
      { value: 'decline', label: 'Always decline to answer' },
      { value: 'answer', label: 'Answer as below' },
    ],
  },
  text('eeo.gender', 'Gender'),
  text('eeo.race', 'Race or ethnicity'),
  text('eeo.veteran', 'Veteran status'),
  text('eeo.disability', 'Disability status'),
];

// `fields`: the error keys (prefs and answers paths, unprefixed) each section owns, for its error dot.
const SECTIONS = [
  { id: 'want', label: 'What I want', icon: 'pi-sliders-h', fields: [...WANT_FIELDS.map((f) => f.key), 'salaryFloor'] },
  { id: 'sources', label: 'Sources', icon: 'pi-globe', fields: ['sources', 'watched', 'feeds'] },
  { id: 'cv', label: 'Tailored CV', icon: 'pi-id-card', fields: ['cvStyle'] },
  { id: 'answers', label: 'Application answers', icon: 'pi-file-edit', fields: ANSWER_FIELDS.map((f) => f.key) },
  { id: 'automation', label: 'Automation', icon: 'pi-bolt', fields: ['nightly'] },
  { id: 'notifications', label: 'Notifications', icon: 'pi-envelope', fields: ['digest'] },
  { id: 'worker', label: 'Drafting worker', icon: 'pi-microchip-ai', fields: ['worker'] },
];

/** The drafting worker as one choice; picking an agent CLI keeps the sign-in chosen before (Gemini: a key only). */
function workerOf(p: CareerPrefs): WorkerChoice {
  return p.worker.kind === 'cli' ? p.worker.agent : 'api';
}
function setWorker(v: WorkerChoice) {
  const was = prefs.value!.worker;
  prefs.value!.worker =
    v === 'api'
      ? { kind: 'api' }
      : { kind: 'cli', agent: v, auth: v === 'gemini' ? 'key' : was.kind === 'cli' ? was.auth : 'subscription' };
}
const keys = ref<SecretStatus[] | null>(null);
const keyOf = (name: SecretName) => keys.value?.find((k) => k.name === name);
function keySet(name: SecretName) {
  return !!keyOf(name)?.source && !keyOf(name)?.undecryptable;
}
/** The key the chosen agent CLI signs in with, if it is one. */
function needed(): SecretName | null {
  const w = prefs.value?.worker;
  return w?.kind === 'cli' ? WORKER_KEYS[w.agent][w.auth] : null;
}
const cvEmail = ref('');

const isOn = (s: SourceInfo) => prefs.value?.sources[s.id]?.on ?? s.defaultOn;
function setOn(s: SourceInfo, on: boolean) {
  const p = prefs.value!;
  p.sources[s.id] = { ...p.sources[s.id], on };
}
const option = (id: string, key: string) => prefs.value?.sources[id]?.options?.[key] ?? '';
function setOption(s: SourceInfo, key: string, value: string) {
  const p = prefs.value!;
  const options = { ...p.sources[s.id]?.options, [key]: value };
  if (!value) delete options[key];
  p.sources[s.id] = { on: isOn(s), options };
}

const BOARD_LABEL: Record<string, string> = { greenhouse: 'Greenhouse board' };
const boardLabel = (url: string) => {
  const ats = detectAts(url);
  return ats ? (BOARD_LABEL[ats.kind] ?? `${ats.kind[0].toUpperCase()}${ats.kind.slice(1)} board`) : 'Careers page';
};

function addFeed(url: string) {
  prefs.value!.feeds = [...prefs.value!.feeds, url];
}

const SUGGESTED_PREFS = ['roles', 'keywords', 'seniority', 'fields', 'locations', 'languages'] as const;

/**
 * Asks the server for settings suggested from the CV and publications; nothing is saved until Save. `replace` swaps
 * the suggested prefs in (the button); otherwise only empty ones are filled (the first visit). Locations and answers
 * only ever fill empty fields. A failure leaves the form as it was.
 */
async function suggest(replace: boolean) {
  suggesting.value = true;
  try {
    const s = await api<{
      prefs: Pick<CareerPrefs, (typeof SUGGESTED_PREFS)[number]>;
      answers: Pick<ApplicationAnswers, 'phone' | 'address' | 'links'>;
    }>('career/suggest', { method: 'POST' });
    const p = prefs.value!;
    for (const k of SUGGESTED_PREFS)
      if ((replace && k !== 'locations') || !p[k].length) {
        (p as Record<string, unknown>)[k] = s.prefs[k];
        filled.value = true;
      }
    const a = answers.value!;
    const fill = <K extends 'phone' | 'address' | 'links'>(k: K, empty: boolean) => {
      if (!empty || !s.answers[k].length) return;
      a[k] = s.answers[k];
      filled.value = true;
    };
    fill('phone', !a.phone.trim());
    fill('address', !a.address.trim());
    fill('links', !a.links.length);
    suggestError.value = '';
  } catch (e) {
    suggestError.value = (e as Error).message;
  } finally {
    suggesting.value = false;
  }
}

async function load() {
  try {
    const s = await api<{ prefs: CareerPrefs; answers: ApplicationAnswers }>('career/settings');
    prefs.value = s.prefs;
    answers.value = s.answers;
    floor.value = { ...s.prefs.salaryFloor };
    saved.value = snapshot();
    const p = s.prefs;
    if (![p.roles, p.keywords, p.fields, p.watched, p.feeds].some((l) => l.length)) void suggest(false);
  } catch (e) {
    report(e);
  }
}

/** Preferences and answers in one PUT; a field error opens the section that holds it. */
async function save() {
  const f = floor.value;
  const salaryFloor =
    f.amount === undefined ? null : { amount: f.amount, currency: f.currency ?? '', period: f.period ?? 'year' };
  saving.value = true;
  errors.value = {};
  try {
    const s = await api<{ prefs: CareerPrefs; answers: ApplicationAnswers }>('career/settings', {
      method: 'PUT',
      body: { prefs: { ...prefs.value!, salaryFloor }, answers: answers.value },
    });
    prefs.value = s.prefs;
    answers.value = s.answers;
    floor.value = { ...s.prefs.salaryFloor };
    saved.value = snapshot();
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
  void load();
  const [s, c] = await Promise.allSettled([
    api<{ sources: SourceInfo[]; suggestedFeeds: { label: string; url: string }[] }>('career/sources'),
    api<{ data: CvStylesConfig }>('cv/styles'),
  ]);
  if (s.status === 'fulfilled') {
    sources.value = s.value.sources;
    suggested.value = s.value.suggestedFeeds;
  } else report(s.reason);
  if (c.status === 'fulfilled') styles.value = c.value.data.styles.map(({ id, name }) => ({ id, name }));
  // Only for the Notifications and Drafting worker notes: a failure leaves those notes out, not the form.
  const [career, ai, cv] = await Promise.allSettled([
    api<SecretStatus[]>('career/keys'),
    api<SecretStatus[]>('ai/keys'),
    api<{ data: CvConfig }>('config/cv'),
  ]);
  keys.value = [career, ai].flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (cv.status === 'fulfilled') cvEmail.value = cv.value.data.cv?.email ?? '';
});
</script>

<template>
  <AdminShell :ctx="ctx" active="career" title="Job search settings" :dirty="dirty">
    <template #actions>
      <Button icon="pi pi-check" label="Save" :loading="saving" :disabled="saving || !prefs" @click="save" />
    </template>
    <AdminTabLinks
      class="cs-tabs"
      label="Job search"
      :tabs="[
        { href: `${base}/career`, label: 'Postings' },
        { href: `${base}/career?status=ready`, label: 'Ready for approval', count: session.careerReady ?? undefined },
        { href: `${base}/career/settings`, label: 'Settings', current: true },
      ]"
    />

    <template v-if="prefs && answers">
      <p v-if="suggestError" class="cs-note tint-danger" role="alert">
        <i class="pi pi-exclamation-circle" aria-hidden="true" />
        <span
          >{{ suggestError }} <a v-if="/ is not set/.test(suggestError)" :href="`${base}/ai#keys`">Add the key</a></span
        >
      </p>
      <p v-else-if="filled" class="cs-note tint-primary" role="status">
        <i class="pi pi-sparkles" aria-hidden="true" />
        <span>Suggested from your CV and publications. Review, then Save.</span>
      </p>
      <AdminSections v-model="section" :sections="SECTIONS" :errors="errors">
        <template #want>
          <section class="card" aria-labelledby="cs-want">
            <div class="card-head cs-head">
              <span class="cs-icon tint-primary" aria-hidden="true"><i class="pi pi-sliders-h" /></span>
              <h2 id="cs-want" class="card-title">What I want</h2>
              <Button
                class="cs-head-end"
                icon="pi pi-sparkles"
                :label="suggesting ? 'Suggesting…' : 'Suggest from my site'"
                :loading="suggesting"
                :disabled="suggesting"
                size="small"
                severity="secondary"
                outlined
                @click="suggest(true)"
              />
            </div>
            <FormFields :fields="WANT_FIELDS" :model="prefs" :errors="errors" />
            <div class="cs-rule" />
            <FormFields :fields="FLOOR_FIELDS" :model="floor" />
          </section>
        </template>

        <template #sources>
          <section class="card" aria-labelledby="cs-sources">
            <div class="card-head cs-head">
              <span class="cs-icon tint-primary" aria-hidden="true"><i class="pi pi-globe" /></span>
              <div>
                <h2 id="cs-sources" class="card-title">Sources</h2>
                <p class="card-subtitle">
                  Keys for job sources are on <a :href="`${base}/ai#keys`">Integrations → Keys</a>.
                </p>
              </div>
            </div>
            <div class="cs-sources">
              <div v-for="s in sources" :key="s.id" class="cs-source" :class="{ 'is-on': isOn(s) }">
                <label class="cs-check">
                  <Checkbox binary :model-value="isOn(s)" @update:model-value="setOn(s, $event)" />
                  <span>{{ s.label }}</span>
                </label>
                <small v-if="s.needs.length" class="cs-hint"
                  >Needs {{ s.needs.join(', ') }} (<a :href="`${base}/ai#keys`">Integrations → Keys</a>).</small
                >
                <small v-if="s.warning" class="cs-warn" role="note"
                  ><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ s.warning }}</small
                >
                <label v-for="o in SOURCE_OPTIONS[s.id] ?? []" :key="o.key" class="cs-field">
                  <span>{{ s.label }}: {{ o.label }}</span>
                  <InputText
                    type="text"
                    :model-value="option(s.id, o.key)"
                    :placeholder="o.placeholder"
                    @update:model-value="setOption(s, o.key, $event ?? '')"
                  />
                </label>
              </div>
            </div>
          </section>

          <section class="card" aria-labelledby="cs-watched">
            <div class="card-head cs-head">
              <span class="cs-icon tint-info" aria-hidden="true"><i class="pi pi-building" /></span>
              <h2 id="cs-watched" class="card-title">Watched companies</h2>
            </div>
            <FormFields :fields="WATCHED_FIELDS" :model="prefs" :errors="errors" />
            <ul v-if="prefs.watched.length" class="cs-watched">
              <li v-for="(url, i) in prefs.watched" :key="i" class="list-row">
                <span class="cs-url">{{ url }}</span>
                <span class="chip chip-info">{{ boardLabel(url) }}</span>
              </li>
            </ul>
          </section>

          <section class="card" aria-labelledby="cs-feeds">
            <div class="card-head cs-head">
              <span class="cs-icon tint-warning" aria-hidden="true"><i class="pi pi-wave-pulse" /></span>
              <h2 id="cs-feeds" class="card-title">Feeds</h2>
            </div>
            <FormFields :fields="FEED_FIELDS" :model="prefs" :errors="errors" />
            <template v-if="suggested.some((f) => !prefs!.feeds.includes(f.url))">
              <p class="cs-hint cs-suggested-label">Suggested academic feeds:</p>
              <div class="cs-actions">
                <Button
                  v-for="f in suggested.filter((f) => !prefs!.feeds.includes(f.url))"
                  :key="f.url"
                  :label="`+ ${f.label}`"
                  size="small"
                  severity="secondary"
                  outlined
                  @click="addFeed(f.url)"
                />
              </div>
            </template>
          </section>
        </template>

        <template #cv>
          <section class="card" aria-labelledby="cs-cv">
            <div class="card-head cs-head">
              <span class="cs-icon tint-primary" aria-hidden="true"><i class="pi pi-id-card" /></span>
              <h2 id="cs-cv" class="card-title">Tailored CV</h2>
            </div>
            <div class="cs-field">
              <span id="cs-cv-style">CV style for tailored CVs</span>
              <Select
                v-model="prefs.cvStyle"
                :options="styleOptions"
                option-label="name"
                option-value="id"
                aria-labelledby="cs-cv-style"
                class="cs-select"
              />
            </div>
          </section>
        </template>

        <template #answers>
          <section class="card" aria-labelledby="cs-answers">
            <div class="card-head cs-head">
              <span class="cs-icon tint-primary" aria-hidden="true"><i class="pi pi-file-edit" /></span>
              <div>
                <h2 id="cs-answers" class="card-title">Application answers</h2>
                <p class="card-subtitle">
                  Used to fill application forms. Anything left empty is handed back to you, never guessed.
                </p>
              </div>
            </div>
            <FormFields :fields="ANSWER_FIELDS" :model="answers" :errors="errors" />
          </section>
        </template>

        <template #automation>
          <section class="card" aria-labelledby="cs-automation">
            <div class="card-head cs-head">
              <span class="cs-icon tint-primary" aria-hidden="true"><i class="pi pi-bolt" /></span>
              <h2 id="cs-automation" class="card-title">Automation</h2>
            </div>
            <fieldset class="cs-choices">
              <legend>How far the nightly run goes</legend>
              <label v-for="[n, label, line] in STAGES" :key="n" class="cs-choice">
                <input v-model="prefs.nightly.stage" type="radio" name="stage" :value="n" />
                <span
                  >{{ label }}<span class="cs-choice-line">{{ line }}</span></span
                >
              </label>
            </fieldset>
            <p class="cs-note tint-success">
              <i class="pi pi-shield" aria-hidden="true" /> <span>Submission always waits for your approval.</span>
            </p>
          </section>
          <section class="card" aria-labelledby="cs-limits">
            <div class="card-head cs-head">
              <span class="cs-icon tint-warning" aria-hidden="true"><i class="pi pi-gauge" /></span>
              <h2 id="cs-limits" class="card-title">Limits</h2>
            </div>
            <FormFields :fields="LIMIT_FIELDS" :model="prefs" :errors="errors" />
          </section>
        </template>

        <template #notifications>
          <section class="card" aria-labelledby="cs-digest">
            <div class="card-head cs-head">
              <span class="cs-icon tint-primary" aria-hidden="true"><i class="pi pi-envelope" /></span>
              <div>
                <h2 id="cs-digest" class="card-title">Email digest</h2>
                <p class="card-subtitle">
                  The dashboard and the sidebar always show what waits for approval, and so does the Ready for approval
                  tab.
                </p>
              </div>
            </div>
            <p v-if="keys && !keySet('RESEND_API_KEY')" class="cs-note tint-warning" role="note">
              <i class="pi pi-info-circle" aria-hidden="true" />
              <span
                >The digest is sent through Resend, and there is no Resend key yet.
                <a :href="`${base}/ai#keys`">Add it on Integrations → Keys</a>.</span
              >
            </p>
            <div class="cs-form">
              <label class="cs-check">
                <Checkbox v-model="prefs.digest.on" binary />
                <span>Email me a digest after each nightly run</span>
              </label>
              <label class="cs-field">
                <span>To</span>
                <InputText
                  v-model="prefs.digest.to"
                  type="email"
                  autocomplete="email"
                  :placeholder="cvEmail || 'you@example.org'"
                  :invalid="!!errors['digest.to']"
                  v-bind="errors['digest.to'] ? { 'aria-invalid': 'true' } : {}"
                />
                <span v-if="errors['digest.to']" class="cs-err">{{ errors['digest.to'] }}</span>
              </label>
              <label class="cs-field">
                <span>From</span>
                <InputText v-model="prefs.digest.from" type="text" placeholder="ScholarOS <onboarding@resend.dev>" />
                <small class="cs-hint"
                  >onboarding@resend.dev only delivers to your Resend account’s email until you verify a domain.</small
                >
                <span v-if="errors['digest.from']" class="cs-err">{{ errors['digest.from'] }}</span>
              </label>
            </div>
          </section>
        </template>

        <template #worker>
          <section class="card" aria-labelledby="cs-worker">
            <div class="card-head cs-head">
              <span class="cs-icon tint-primary" aria-hidden="true"><i class="pi pi-microchip-ai" /></span>
              <h2 id="cs-worker" class="card-title">Drafting worker</h2>
            </div>
            <div class="cs-form">
              <fieldset class="cs-choices">
                <legend>Drafts, their review and form answers are written by</legend>
                <label v-for="[id, label, line] in WORKERS" :key="id" class="cs-choice">
                  <input
                    type="radio"
                    name="worker"
                    :value="id"
                    :checked="workerOf(prefs) === id"
                    @change="setWorker(id)"
                  />
                  <span
                    >{{ label }}<span class="cs-choice-line">{{ line }}</span></span
                  >
                </label>
              </fieldset>
              <p v-if="workerOf(prefs) === 'gemini'" class="cs-hint">
                Antigravity has no sign-in that works unattended yet, so this slot runs Gemini CLI with your Gemini API
                key.
              </p>
              <fieldset v-if="prefs.worker.kind === 'cli' && prefs.worker.agent !== 'gemini'" class="cs-choices">
                <legend>Sign in with</legend>
                <label class="cs-choice">
                  <input v-model="prefs.worker.auth" type="radio" name="auth" value="subscription" />
                  <span
                    >Subscription<span class="cs-choice-line">{{
                      prefs.worker.agent === 'claude'
                        ? 'Your Claude plan, through a Claude Code token.'
                        : 'Your ChatGPT plan, through Codex’s sign-in file.'
                    }}</span></span
                  >
                </label>
                <label class="cs-choice">
                  <input v-model="prefs.worker.auth" type="radio" name="auth" value="key" />
                  <span
                    >Key<span class="cs-choice-line">{{
                      prefs.worker.agent === 'claude'
                        ? 'Your Anthropic API key, billed per use.'
                        : 'Your OpenAI API key, billed per use.'
                    }}</span></span
                  >
                </label>
              </fieldset>
              <p v-if="needed()" class="cs-hint">
                Uses {{ keyOf(needed()!)?.label ?? needed() }} (<code>{{ needed() }}</code
                >)<template v-if="keys && !keySet(needed()!)">, which isn’t set yet</template>:
                <a :href="`${base}/ai#keys`">Integrations → Keys</a>.
              </p>
              <p v-if="prefs.worker.kind === 'cli'" class="cs-hint">
                When a subscription runs out of quota, the run stops and says so. It never falls back to paid API use.
              </p>
              <p class="cs-hint">Scoring always uses the API provider.</p>
            </div>
          </section>
        </template>
      </AdminSections>
    </template>
    <div v-else class="card" aria-hidden="true">
      <Skeleton v-for="n in 5" :key="n" height="2.5rem" class="mb-3" />
    </div>
  </AdminShell>
</template>

<style scoped>
.cs-tabs.adm-tablinks {
  gap: 0 0.5rem;
  margin-block: -0.75rem 1.5rem;
  border-block-end: 1px solid var(--app-border);
}
.cs-tabs.adm-tablinks :deep(a) {
  min-height: 2.75rem;
  padding-inline: 0.875rem;
  color: var(--app-body);
  font-size: 0.9375rem;
  font-weight: 500;
}
.cs-tabs.adm-tablinks :deep(a:hover) {
  color: var(--p-primary-color);
}
.cs-tabs.adm-tablinks :deep(a[aria-current='page']) {
  border-block-end-color: var(--p-primary-color);
  color: var(--p-primary-color);
}
.cs-tabs.adm-tablinks :deep(.adm-count) {
  display: inline-grid;
  place-items: center;
  min-width: 1.375rem;
  height: 1.375rem;
  padding: 0 0.375rem;
  border-radius: 999px;
  background: var(--c-danger);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
}

.cs-head {
  flex-wrap: nowrap;
  justify-content: flex-start;
  margin-block-end: 1.5rem;
}
.cs-head-end {
  flex: none;
  margin-inline-start: auto;
}
.cs-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  font-size: 1.05rem;
}
.card-subtitle a {
  font-weight: 500;
}
.cs-rule {
  margin-block: 1.5rem;
  border-top: 1px dashed var(--app-border);
}
.cs-note {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  margin: 0 0 1.25rem;
  padding: 0.875rem 1rem;
  border-radius: 0.625rem;
  color: var(--app-heading);
  font-size: 0.875rem;
}
.cs-note .pi {
  margin-block-start: 0.1875rem;
}
.cs-note.tint-danger {
  box-shadow: inset 3px 0 0 var(--c-danger);
}
.cs-note.tint-warning {
  box-shadow: inset 3px 0 0 var(--c-warning);
}
.cs-note.tint-primary {
  box-shadow: inset 3px 0 0 var(--c-primary);
}
.cs-note.tint-success {
  box-shadow: inset 3px 0 0 var(--c-success);
}
.card .cs-note:last-child {
  margin: 1.25rem 0 0;
}
.cs-form {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
}
.cs-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
}
.cs-field > span:first-child,
.cs-choices > legend {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.cs-select {
  width: 100%;
  max-width: 24rem;
}
.cs-hint {
  margin: 0;
  color: var(--app-muted);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.cs-err {
  color: var(--c-danger);
  font-size: 0.8125rem;
}
.cs-warn {
  color: #b56605;
  font-size: 0.8125rem;
}
:global(.app-dark) .cs-warn {
  color: #f7a23a;
}
.cs-check {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: fit-content;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}
/* The legacy `.adm input` rule (admin.css) would flatten PrimeVue's inputs; keep their own look. */
.adm .card :is(input.p-inputtext) {
  padding: var(--p-inputtext-padding-y) var(--p-inputtext-padding-x);
  border-color: var(--p-inputtext-border-color);
  border-radius: var(--p-inputtext-border-radius);
  background: var(--p-inputtext-background);
  color: var(--p-inputtext-color);
  font-size: 0.9375rem;
}
.adm .card :is(input.p-inputtext):enabled:hover {
  border-color: var(--p-inputtext-hover-border-color);
}
.adm .card :is(input.p-inputtext):enabled:focus {
  border-color: var(--p-inputtext-focus-border-color);
}
.adm .card :is(input.p-inputtext).p-invalid {
  border-color: var(--p-inputtext-invalid-border-color);
}

/* Sources: one tile each. */
.cs-sources {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  align-items: start;
  gap: 0.75rem;
}
.cs-source {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.cs-source.is-on {
  border-color: color-mix(in srgb, var(--p-primary-color) 45%, transparent);
  background: color-mix(in srgb, var(--p-primary-color) 4%, transparent);
}
.cs-watched {
  margin: 1rem 0 0;
  padding: 0 1rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  list-style: none;
}
.cs-url {
  min-width: 0;
  overflow: hidden;
  color: var(--app-heading);
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cs-suggested-label {
  margin-block: 1.25rem 0.5rem;
}
.cs-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* Radio choices as selectable tiles. */
.cs-choices {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.cs-choices > legend {
  margin-block-end: 0.625rem;
  padding: 0;
}
.cs-choice {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.cs-choice:hover {
  border-color: color-mix(in srgb, var(--p-primary-color) 40%, var(--app-border));
}
.cs-choice:has(input:checked) {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 6%, transparent);
}
.cs-choice input {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
  margin: 0.0625rem 0 0;
  accent-color: var(--p-primary-color);
}
.cs-choice-line {
  display: block;
  margin-block-start: 0.125rem;
  color: var(--app-muted);
  font-size: 0.8125rem;
  font-weight: 400;
}

@media (max-width: 575.98px) {
  .cs-head {
    flex-wrap: wrap;
  }
}
</style>
