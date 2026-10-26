<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Skeleton from 'primevue/skeleton';
import Textarea from 'primevue/textarea';
import Timeline from 'primevue/timeline';
import AdminShell from './AdminShell.vue';
import AdminTabLinks from './AdminTabLinks.vue';
import { ApiError, api, report, session, toast } from './api';
import { formatDateTime } from './dates';
import { vDialog } from './dialog';
import {
  applyLinks,
  coverageLine,
  coverageState,
  evidenceLabel,
  fieldSource,
  httpUrl,
  isApplying,
  isChoice,
  isTicked,
  uploadFor,
  visible,
} from './career';
import { PostingText } from './PostingText';
import { STATUS_TINT } from './ui/career/tint';
import type { AdminCtx } from './types';
import { entryText } from '../lib/career/profile';
import type { FormAnswer } from '../lib/career/answers';
import type { ScoreDetail } from '../lib/career/score';
import type { Requirement, ReviewIssue, TailorPlan } from '../lib/career/tailor';
import type { Posting, PostingStatus } from '../lib/career/types';
import type { CvConfig } from '../lib/types';

// Every string from the posting is third-party text, and the letter and review issues are AI output derived from it:
// shown with {{ }} or in textareas only, never as HTML.
const props = defineProps<{ ctx: AdminCtx; id: string }>();
const base = `/${props.ctx.adminPath}`;
const STATUSES: PostingStatus[] = [
  'found',
  'skipped',
  'drafted',
  'ready',
  'submitted',
  'interview',
  'offer',
  'rejected',
  'no-response',
  'withdrawn',
];
const DIMENSIONS = ['technical', 'experience', 'culture', 'career'] as const;
const VERDICTS = ['location', 'language', 'eligibility'] as const;
/** The usual way through the statuses, drawn beside the status select (presentation only). */
const PIPELINE: PostingStatus[] = ['found', 'drafted', 'ready', 'submitted', 'interview', 'offer'];
const VERDICT_TINT: Record<string, string> = {
  pass: 'success',
  fail: 'danger',
  flag: 'warning',
  unverified: 'warning',
};

interface JobEvent {
  at: string;
  kind: string;
  detail: string | null;
}

type Part = 'all' | 'cv' | 'letter' | 'render' | 'answers';
type Plan = Pick<TailorPlan, 'sections'> & { requirements?: Requirement[] };
interface EditEntry {
  ref: number;
  on: boolean;
  label: string;
  text?: string;
  /** One per line. */
  highlights?: string;
  max?: number;
  /** A comma list (skills): its own items, reordered or trimmed. */
  details?: string;
}
interface EditSection {
  title: string;
  on: boolean;
  entries: EditEntry[];
}

const posting = ref<Posting | null>(null);
const events = ref<JobEvent[]>([]);
const notes = ref('');
const loading = ref(true);
const missing = ref(false);
const cvSections = ref<CvConfig['cv']['sections']>({});
const letter = ref('');
const instruction = reactive({ all: '', cv: '', letter: '', answers: '' });
const answers = ref<FormAnswer[]>([]);
const editor = ref<EditSection[]>([]);
let timer: ReturnType<typeof setInterval> | undefined;

const detail = computed(() => posting.value?.scoreDetail as ScoreDetail | null);
const link = computed(() => httpUrl(posting.value?.url));
const applyLink = computed(() => httpUrl(posting.value?.applyUrl));
const when = (iso: string) => new Date(iso).toLocaleString();
const drafting = computed(() => posting.value?.draftState === 'running');
const issues = computed(() =>
  posting.value?.draftState === 'needs-review' ? ((posting.value.draftIssues as ReviewIssue[] | null) ?? []) : [],
);
const pdf = computed(() => httpUrl(posting.value?.cvPdfUrl));
/** Only our own Blob store's PDFs (or `pnpm dev`'s /uploads/) are embedded; any other URL is just a link. */
const embed = computed(() => {
  if (pdf.value?.startsWith('/uploads/')) return pdf.value;
  try {
    const u = new URL(pdf.value ?? '');
    return u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com') ? u.href : null;
  } catch {
    return null;
  }
});

/** The plan editor: the plan's sections and entries first, in plan order, then the rest of the CV switched off. */
function buildEditor() {
  const plan = (posting.value?.cv as Plan | null)?.sections ?? [];
  const own = cvSections.value;
  const titles = [...plan.map((s) => s.title), ...Object.keys(own)].filter(
    (t, i, all) => Object.hasOwn(own, t) && all.indexOf(t) === i,
  );
  editor.value = titles.map((title) => {
    const entries = (own[title] ?? []) as unknown[];
    const chosen = plan.find((s) => s.title === title)?.entries ?? [];
    // Hidden entries stay off the CV: assembleCv refuses them.
    const refs = [...chosen.map((e) => e.ref), ...entries.keys()].filter(
      (r, i, all) =>
        r < entries.length && all.indexOf(r) === i && (entries[r] as { visible?: unknown })?.visible !== false,
    );
    return {
      title,
      on: chosen.length > 0,
      entries: refs.map((ref) => {
        const entry = entries[ref];
        const picked = chosen.find((e) => e.ref === ref);
        const had = (entry as { highlights?: unknown })?.highlights;
        const details = (entry as { details?: unknown })?.details;
        return {
          ref,
          on: !!picked,
          label: entryText(entry).split('\n')[0] || '(hidden entry)',
          ...(typeof entry === 'string' ? { text: picked?.text ?? entry } : {}),
          ...(Array.isArray(had) ? { highlights: (picked?.highlights ?? had).join('\n'), max: had.length } : {}),
          ...(typeof details === 'string' ? { details: picked?.details ?? details } : {}),
        };
      }),
    };
  });
}

interface JobView {
  posting: Posting;
  events: JobEvent[];
  /** The base CV's sections, with the publications collection when the CV lists none (baseCv). */
  cvSections: CvConfig['cv']['sections'];
}

function take(res: JobView) {
  const app = res.posting.application;
  // Edited values survive other saves on the page; a new pre-fill brings its own.
  if (app?.at !== posting.value?.application?.at)
    values.value = Object.fromEntries((app?.fields ?? []).map((f) => [f.id, f.value]));
  posting.value = res.posting;
  cvSections.value = res.cvSections;
  events.value = res.events;
  notes.value = res.posting.notes;
  letter.value = res.posting.letter ?? '';
  answers.value = structuredClone((res.posting.answers as FormAnswer[] | null) ?? []);
  buildEditor();
}

async function patch(body: {
  status?: PostingStatus;
  notes?: string;
  cv?: Plan;
  letter?: string;
  answers?: FormAnswer[];
}) {
  try {
    take(await api(`career/postings/${props.id}`, { method: 'PATCH', body }));
    return true;
  } catch (e) {
    report(e);
    return false;
  }
}

/** A failed save puts the select back on the saved status. */
async function setStatus(el: HTMLSelectElement) {
  if (!(await patch({ status: el.value as PostingStatus }))) el.value = posting.value!.status;
}

function stop() {
  clearInterval(timer);
  timer = undefined;
}
/** Polls every 5 s; an approval still waiting for the queue after 2 minutes is checked every minute instead. */
let fastSince: number | null = null;
function watch() {
  if (timer) return;
  fastSince = Date.now();
  timer = setInterval(poll, 5000);
}
const working = (p: Posting) => p.draftState === 'running' || isApplying(p.application?.state);
async function poll() {
  try {
    const res = await api<JobView>(`career/postings/${props.id}`);
    if (!working(res.posting)) {
      stop();
      take(res);
    } else if (res.posting.application?.state === 'approved' && fastSince && Date.now() - fastSince > 120_000) {
      fastSince = null;
      clearInterval(timer);
      timer = setInterval(poll, 60_000);
    }
  } catch (e) {
    stop();
    report(e);
  }
}

async function draft(part: Part) {
  try {
    await api(`career/postings/${props.id}/draft`, {
      body: { part, instruction: part === 'render' ? '' : instruction[part] },
    });
    posting.value = { ...posting.value!, draftState: 'running' };
    watch();
  } catch (e) {
    report(e);
  }
}

function move(i: number, by: number) {
  const list = editor.value;
  [list[i], list[i + by]] = [list[i + by], list[i]];
}

/** Saves the edited plan, then re-renders it (no AI). */
async function savePlan() {
  const requirements = (posting.value?.cv as Plan | null)?.requirements;
  const cv: Plan = {
    ...(requirements ? { requirements } : {}),
    sections: editor.value
      .filter((s) => s.on)
      .map((s) => ({
        title: s.title,
        entries: s.entries
          .filter((e) => e.on)
          .map((e) => ({
            ref: e.ref,
            ...(e.text === undefined ? {} : { text: e.text }),
            ...(e.details === undefined ? {} : { details: e.details }),
            ...(e.highlights === undefined
              ? {}
              : {
                  highlights: e.highlights
                    .split('\n')
                    .map((h) => h.trim())
                    .filter(Boolean),
                }),
          })),
      })),
  };
  if (await patch({ cv })) await draft('render');
}

const requirements = computed(() => {
  const reqs = (posting.value?.cv as Plan | null)?.requirements;
  return reqs && [...reqs.filter((r) => r.kind === 'required'), ...reqs.filter((r) => r.kind === 'preferred')];
});

function coverageNote(r: Requirement): string {
  const state = coverageState(r);
  const base =
    state === 'shown'
      ? 'In the CV'
      : state === 'cut'
        ? 'In your CV, not in this version; restore it in the editor below'
        : state === 'reworded'
          ? `Supported by ${evidenceLabel(visible(r.evidence ?? ''))}, in other words`
          : 'Not in your CV';
  return r.uses && r.uses > 3 ? `${base}; used ${r.uses} times; may read as stuffing` : base;
}

const SOURCES: Record<FormAnswer['source'], string> = {
  cv: 'Your CV',
  answers: 'Your answers',
  ai: 'Drafted by AI: check it',
  handoff: 'You’ll answer this one',
  file: 'File upload',
};

/** Saves an edited value; an owner-typed answer is no longer the AI's or a hand-off. */
function saveAnswer(i: number) {
  const a = answers.value[i];
  const saved = (posting.value?.answers as FormAnswer[] | null)?.[i];
  if (!saved || a.value === saved.value) return;
  // The note held the old option id (or the model's remark); it no longer describes this value.
  delete a.note;
  if (a.source === 'handoff' || a.source === 'ai') a.source = a.value.trim() ? 'answers' : 'handoff';
  patch({ answers: answers.value });
}

function copyAnswers() {
  const text = answers.value
    .filter((a) => a.source !== 'file' && a.value)
    .map((a) => `${visible(a.question)}\n${a.value}`)
    .join('\n\n');
  navigator.clipboard.writeText(text).then(() => toast('Copied'), report);
}

function copyLetter() {
  navigator.clipboard.writeText(letter.value).then(() => toast('Copied'), report);
}

function downloadLetter() {
  const company = posting
    .value!.company.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const url = URL.createObjectURL(new Blob([letter.value], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `cover-letter-${company || 'company'}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url));
}

// The application form: pre-filled on the server, sent only after the owner approves exactly these values.
const app = computed(() => posting.value?.application ?? null);
/** Called from the template: the http(s) links of the application on screen. */
function links() {
  return app.value && applyLinks(app.value, posting.value!.cvPdfUrl);
}
const values = ref<Record<string, string>>({});
const acting = ref(false);
const confirming = ref(false);

type ApplyBody =
  | { action: 'prefill' | 'skip' | 'withdraw' | 'handoff' | 'confirm' | 'not-sent' }
  | { action: 'approve'; at: string; fields: { id: string; value: string }[] };

/** Every apply action answers once the server has moved the application; the page then shows where it is. */
async function apply(body: ApplyBody) {
  acting.value = true;
  let conflict: ApiError | null = null;
  try {
    const res = await api<{ queued?: boolean }>(`career/postings/${props.id}/apply`, { body });
    if (body.action === 'approve')
      toast(
        res.queued === false
          ? 'Approved. It will be submitted when the queue next runs (at the latest with tonight’s run).'
          : 'Approved: it is submitted in the next few minutes',
      );
    if (body.action === 'skip') toast('Skipped');
    if (body.action === 'withdraw') toast('Approval withdrawn: it waits for your approval again');
  } catch (e) {
    // A 409 on approve is usually a pre-fill that ran again meanwhile: those values were never approved.
    if (body.action === 'approve' && e instanceof ApiError && e.status === 409) conflict = e;
    else report(e);
  } finally {
    acting.value = false;
  }
  try {
    const res = await api<JobView>(`career/postings/${props.id}`);
    take(res);
    if (working(res.posting)) watch();
    if (conflict && body.action === 'approve') {
      if (res.posting.application?.at !== body.at)
        toast('This application was pre-filled again; review the new version.');
      else report(conflict);
    }
  } catch (e) {
    report(e);
  }
}
function approveNow() {
  confirming.value = false;
  const fields = app.value!.fields.map((f) => ({ id: f.id, value: values.value[f.id] ?? f.value }));
  void apply({ action: 'approve', at: app.value!.at, fields });
}
function copy(text: string) {
  navigator.clipboard.writeText(text).then(() => toast('Copied'), report);
}

onBeforeUnmount(stop);
onMounted(async () => {
  try {
    const res = await api<JobView>(`career/postings/${props.id}`);
    take(res);
    if (working(res.posting)) watch();
    // The Ready list's Review link points at the Application form, which exists only once the posting loaded.
    if (location.hash) void nextTick(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  } catch (e) {
    missing.value = true;
    report(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="career" :title="posting ? posting.title : 'Job'">
    <AdminTabLinks
      class="job-tabs"
      label="Job search"
      :tabs="[
        { href: `${base}/career`, label: 'Postings', current: posting?.status !== 'ready' },
        {
          href: `${base}/career?status=ready`,
          label: 'Ready for approval',
          current: posting?.status === 'ready',
          count: session.careerReady ?? undefined,
        },
        { href: `${base}/career/settings`, label: 'Settings' },
      ]"
    />
    <div v-if="loading" class="job-grid">
      <p class="adm-visually-hidden">Loading…</p>
      <div class="job-col">
        <div class="card"><Skeleton height="1.5rem" width="40%" class="mb-4" /><Skeleton height="12rem" /></div>
      </div>
      <div class="job-col">
        <div class="card"><Skeleton height="10rem" /></div>
      </div>
    </div>
    <div v-else-if="missing || !posting" class="card empty-state">
      <i class="pi pi-briefcase" aria-hidden="true" />
      <p>This posting could not be loaded.</p>
    </div>
    <template v-else>
      <section class="card job-hero">
        <span class="job-logo" aria-hidden="true">{{ posting.company.trim().charAt(0).toUpperCase() || '?' }}</span>
        <div class="job-hero-main">
          <p class="job-hero-meta">
            <strong>{{ posting.company }}</strong
            ><template v-if="posting.location">
              · <i class="pi pi-map-marker" aria-hidden="true" /> {{ posting.location }}
            </template>
            <template v-if="posting.remote"> · remote</template> · <i class="pi pi-calendar" aria-hidden="true" /> found
            {{ when(posting.foundAt) }}
          </p>
          <span class="job-hero-chips">
            <span :class="['chip', `chip-${STATUS_TINT[posting.status]}`]">{{ posting.status }}</span>
            <span v-if="posting.score !== null" class="chip chip-primary">Score {{ posting.score }}</span>
          </span>
        </div>
        <div v-if="link || applyLink" class="job-hero-actions">
          <Button
            v-if="link"
            as="a"
            :href="link"
            target="_blank"
            rel="noopener noreferrer nofollow"
            label="Original posting"
            icon="pi pi-external-link"
            severity="secondary"
            outlined
          />
          <Button
            v-if="applyLink"
            as="a"
            :href="applyLink"
            target="_blank"
            rel="noopener noreferrer nofollow"
            label="Apply"
            icon="pi pi-external-link"
            severity="secondary"
            outlined
          />
        </div>
      </section>

      <div class="job-grid">
        <div class="job-col">
          <section class="card" aria-labelledby="job-apply">
            <div class="card-head">
              <h2 id="job-apply" class="card-title">
                <i class="pi pi-send text-primary" aria-hidden="true" /> Application form
              </h2>
            </div>
            <template v-if="!app">
              <p class="job-lead">
                A browser on the server opens the application form, fills in every field from your CV and Application
                answers, uploads the tailored CV and letter, and stops before Submit. Nothing is sent until you approve.
              </p>
              <p v-if="!posting.cvPdfUrl" class="job-note tint-warning">
                <i class="pi pi-info-circle" aria-hidden="true" /> Draft the CV first: the form gets the tailored PDF.
              </p>
              <p class="job-actions">
                <Button
                  label="Pre-fill the application"
                  icon="pi pi-pen-to-square"
                  :severity="posting.cvPdfUrl ? undefined : 'secondary'"
                  :outlined="!posting.cvPdfUrl"
                  :disabled="acting || drafting || !posting.cvPdfUrl"
                  @click="apply({ action: 'prefill' })"
                />
                <Button
                  label="Finish it myself"
                  severity="secondary"
                  outlined
                  :disabled="acting"
                  @click="apply({ action: 'handoff' })"
                />
              </p>
            </template>

            <template v-else-if="app.state === 'approved'">
              <p class="job-note tint-info" role="status">
                Approved. It is submitted to {{ links()!.host }} when the queue next runs, usually within a few minutes
                and at the latest with tonight’s run.
              </p>
              <p class="job-actions">
                <Button
                  label="Withdraw approval"
                  severity="secondary"
                  outlined
                  :disabled="acting"
                  @click="apply({ action: 'withdraw' })"
                />
              </p>
            </template>
            <p v-else-if="isApplying(app.state)" class="job-note tint-info" role="status">
              {{
                app.state === 'prefilling'
                  ? `Filling in the form on ${links()!.host}… this takes a minute or two. Nothing is sent.`
                  : `Submitting to ${links()!.host}… this takes a minute or two.`
              }}
            </p>

            <template v-else-if="app.state === 'ready'">
              <p class="job-lead">
                Check each value, then approve. Nothing is sent until you approve; after you approve, it may be
                submitted within minutes, with exactly these values.
              </p>
              <ul v-if="links()!.shots.length" class="job-shots" aria-label="Screenshots of the filled form">
                <li v-for="(src, i) in links()!.shots" :key="src">
                  <a :href="src" target="_blank" rel="noopener noreferrer"
                    ><img
                      :src="src"
                      :alt="`The filled form on ${links()!.host}, screenshot ${i + 1} of ${links()!.shots.length}`"
                      loading="lazy"
                    /><span class="adm-visually-hidden"> (opens full size in a new tab)</span></a
                  >
                </li>
              </ul>
              <p class="job-muted">
                {{ app.fields.length }} fields · <span aria-hidden="true">*</span> required · values marked AI were
                drafted from the posting: check them.
              </p>
              <ul class="job-fields">
                <li v-for="f in app.fields" :key="f.id">
                  <span class="job-field-head">
                    <label :for="`apply-${f.id}`" class="job-label"
                      >{{ visible(f.label) }}<span v-if="f.required" class="job-req" aria-hidden="true"> *</span
                      ><span v-if="f.required" class="adm-visually-hidden"> (required)</span></label
                    >
                    <span :class="['chip', fieldSource(f, values[f.id]) === 'AI' ? 'chip-warning' : 'chip-secondary']"
                      ><span class="adm-visually-hidden">Source: </span>{{ fieldSource(f, values[f.id]) }}</span
                    >
                  </span>
                  <output v-if="f.kind === 'file'" :id="`apply-${f.id}`" class="job-file"
                    ><i class="pi pi-file-pdf" aria-hidden="true" /> {{ uploadFor(f) }}</output
                  >
                  <select v-else-if="isChoice(f)" :id="`apply-${f.id}`" v-model="values[f.id]" class="job-select">
                    <option value="">(not answered)</option>
                    <option v-for="o in f.options" :key="o" :value="o">{{ visible(o) }}</option>
                  </select>
                  <span v-else-if="f.kind === 'checkbox' && !f.options?.length" class="job-check">
                    <input
                      :id="`apply-${f.id}`"
                      type="checkbox"
                      :checked="isTicked(values[f.id])"
                      @change="values[f.id] = ($event.target as HTMLInputElement).checked ? 'true' : ''"
                    />
                    {{ isTicked(values[f.id]) ? 'Ticked' : 'Not ticked' }}
                  </span>
                  <Textarea
                    v-else-if="f.kind === 'textarea'"
                    :id="`apply-${f.id}`"
                    v-model="values[f.id]"
                    rows="3"
                    maxlength="20000"
                    auto-resize
                  />
                  <InputText v-else :id="`apply-${f.id}`" v-model="values[f.id]" type="text" maxlength="20000" />
                  <span v-if="f.note" class="job-hint">{{ visible(f.note) }}</span>
                </li>
              </ul>
              <p class="job-actions">
                <Button icon="pi pi-check" label="Approve and submit" :disabled="acting" @click="confirming = true" />
                <Button
                  label="Skip"
                  severity="secondary"
                  outlined
                  :disabled="acting"
                  @click="apply({ action: 'skip' })"
                />
                <Button
                  label="Finish it myself"
                  severity="secondary"
                  outlined
                  :disabled="acting"
                  @click="apply({ action: 'handoff' })"
                />
              </p>
            </template>

            <template v-else-if="app.state === 'handoff'">
              <h3 class="job-subhead">Finish this one yourself</h3>
              <p v-if="app.reason" class="job-lead">{{ visible(app.reason) }}</p>
              <p class="job-actions">
                <Button
                  v-if="links()!.form"
                  as="a"
                  :href="links()!.form!"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  label="Open the form"
                  icon="pi pi-external-link"
                  icon-pos="right"
                />
                <Button
                  v-if="links()!.cv"
                  as="a"
                  :href="links()!.cv!"
                  target="_blank"
                  rel="noopener noreferrer"
                  label="Tailored CV (PDF)"
                  icon="pi pi-external-link"
                  icon-pos="right"
                  severity="secondary"
                  outlined
                />
                <Button
                  v-if="links()!.letter"
                  as="a"
                  :href="links()!.letter!"
                  target="_blank"
                  rel="noopener noreferrer"
                  label="Cover letter (PDF)"
                  icon="pi pi-external-link"
                  icon-pos="right"
                  severity="secondary"
                  outlined
                />
                <Button
                  v-if="posting.letter"
                  label="Copy the letter"
                  icon="pi pi-copy"
                  severity="secondary"
                  outlined
                  @click="copyLetter"
                />
              </p>
              <template v-if="app.fields.some((f) => f.kind !== 'file')">
                <p class="job-muted">The values prepared for the form, to paste in:</p>
                <ul class="job-rows">
                  <li v-for="f in app.fields.filter((x) => x.kind !== 'file')" :key="f.id">
                    <span class="job-row-main"
                      ><span class="job-label"
                        >{{ visible(f.label) }}<span v-if="f.required" class="job-req" aria-hidden="true"> *</span
                        ><span v-if="f.required" class="adm-visually-hidden"> (required)</span></span
                      >
                      <span class="job-hint job-value">{{
                        f.value ? visible(f.value) : f.note ? visible(f.note) : 'No value prepared'
                      }}</span></span
                    >
                    <Button
                      v-if="f.value"
                      label="Copy"
                      icon="pi pi-copy"
                      size="small"
                      severity="secondary"
                      text
                      :aria-label="`Copy ${visible(f.label)}`"
                      @click="copy(f.value)"
                    />
                  </li>
                </ul>
              </template>
              <p class="job-actions">
                <Button
                  label="Pre-fill again"
                  icon="pi pi-refresh"
                  size="small"
                  severity="secondary"
                  outlined
                  :disabled="acting || !posting.cvPdfUrl"
                  @click="apply({ action: 'prefill' })"
                />
              </p>
            </template>

            <template v-else-if="app.state === 'submitted'">
              <p class="job-note tint-success">
                <i class="pi pi-check-circle" aria-hidden="true" /> Submitted to {{ links()!.host }} on
                <time :datetime="app.at">{{ formatDateTime(app.at) }}</time
                >.
              </p>
              <a
                v-if="links()!.confirmation"
                class="job-shot"
                :href="links()!.confirmation!"
                target="_blank"
                rel="noopener noreferrer"
                ><img
                  :src="links()!.confirmation!"
                  :alt="`The confirmation page on ${links()!.host}`"
                  loading="lazy"
                /><span class="adm-visually-hidden"> (opens full size in a new tab)</span></a
              >
            </template>

            <template v-else-if="app.state === 'unconfirmed'">
              <p class="job-note tint-warning">
                Submitted, but the site didn’t confirm it. Check your email or the employer’s portal.
              </p>
              <p v-if="app.reason" class="job-muted">{{ visible(app.reason) }}</p>
              <a
                v-if="links()!.confirmation"
                class="job-shot"
                :href="links()!.confirmation!"
                target="_blank"
                rel="noopener noreferrer"
                ><img
                  :src="links()!.confirmation!"
                  :alt="`The page on ${links()!.host} after submitting`"
                  loading="lazy"
                /><span class="adm-visually-hidden"> (opens full size in a new tab)</span></a
              >
              <p class="job-actions">
                <Button
                  label="Mark as submitted"
                  severity="secondary"
                  outlined
                  :disabled="acting"
                  @click="apply({ action: 'confirm' })"
                />
                <Button
                  label="It wasn’t sent"
                  severity="secondary"
                  outlined
                  :disabled="acting"
                  @click="apply({ action: 'not-sent' })"
                />
              </p>
            </template>

            <template v-else>
              <p class="job-note tint-danger">
                {{ app.state === 'changed' ? 'The form changed since it was pre-filled.' : 'This didn’t work.' }}
                <template v-if="app.reason">{{ visible(app.reason) }}</template>
              </p>
              <p class="job-actions">
                <Button
                  :label="app.state === 'changed' ? 'Pre-fill again' : 'Retry'"
                  icon="pi pi-refresh"
                  :disabled="acting || !posting.cvPdfUrl"
                  @click="apply({ action: 'prefill' })"
                />
                <Button
                  label="Finish it myself"
                  severity="secondary"
                  outlined
                  :disabled="acting"
                  @click="apply({ action: 'handoff' })"
                />
              </p>
            </template>
          </section>

          <section class="card" aria-labelledby="job-draft">
            <div class="card-head">
              <h2 id="job-draft" class="card-title">
                <i class="pi pi-sparkles text-primary" aria-hidden="true" /> Application draft
              </h2>
            </div>
            <p aria-live="polite" class="job-muted">
              <template v-if="drafting">
                <i class="pi pi-spin pi-spinner" aria-hidden="true" /> Drafting… this takes a minute or two.
              </template>
              <template v-else-if="posting.draftState === 'failed'">
                The last draft failed: see History for why.
              </template>
              <template v-else-if="posting.draftState === 'none'">No draft yet.</template>
              <template v-else-if="posting.draftState === 'done'">
                Drafted, and the review found nothing unsupported.
              </template>
            </p>
            <div
              v-if="issues.length || posting.draftState === 'needs-review'"
              class="job-note tint-warning"
              role="alert"
            >
              <div>
                <strong>Check these before sending:</strong> the reviewer still found claims the CV may not support.
                <ul>
                  <li v-for="(i, n) in issues" :key="n">
                    <template v-if="i.part">{{ i.part === 'cv' ? 'CV' : 'Letter' }} · </template>
                    {{ visible(i.where) }}: “{{ visible(i.claim) }}”, {{ visible(i.why) }}
                  </li>
                </ul>
              </div>
            </div>
            <div class="job-inline">
              <label class="job-field">
                <span>Instruction (optional)</span>
                <InputText
                  v-model="instruction.all"
                  type="text"
                  maxlength="500"
                  placeholder="e.g. lead with the teaching experience"
                />
              </label>
              <Button
                :label="posting.draftState === 'none' ? 'Draft CV and letter' : 'Regenerate both'"
                icon="pi pi-sparkles"
                :disabled="drafting"
                @click="draft('all')"
              />
            </div>
          </section>

          <section v-if="posting.cv" class="card" aria-labelledby="job-cv">
            <div class="card-head">
              <h2 id="job-cv" class="card-title">
                <i class="pi pi-id-card text-primary" aria-hidden="true" /> Tailored CV
              </h2>
              <Button
                v-if="pdf"
                as="a"
                :href="pdf"
                target="_blank"
                rel="noopener noreferrer"
                label="Open PDF"
                icon="pi pi-file-pdf"
                size="small"
                severity="secondary"
                outlined
              />
            </div>
            <div v-if="requirements" class="job-reqs">
              <h3 class="job-subhead">Posting requirements</h3>
              <p class="job-muted">{{ coverageLine(requirements) }}</p>
              <ul v-if="requirements.length">
                <li v-for="r in requirements" :key="r.kind + r.term">
                  <i
                    :class="[
                      'pi',
                      coverageState(r) === 'gap'
                        ? 'pi-times-circle is-gap'
                        : coverageState(r) === 'cut'
                          ? 'pi-minus-circle is-cut'
                          : 'pi-check-circle is-ok',
                    ]"
                    aria-hidden="true"
                  />
                  <span
                    ><strong>{{ visible(r.term) }}</strong> ({{ r.kind }}): {{ coverageNote(r) }}</span
                  >
                </li>
              </ul>
            </div>
            <p v-if="!pdf" class="job-muted">No PDF yet.</p>
            <iframe v-if="embed" :src="embed" title="Tailored CV preview" class="job-pdf" />
            <div class="job-inline">
              <label class="job-field">
                <span>Regenerate with an instruction</span>
                <InputText
                  v-model="instruction.cv"
                  type="text"
                  maxlength="500"
                  placeholder="e.g. one page, drop the awards"
                />
              </label>
              <Button
                label="Regenerate CV"
                icon="pi pi-refresh"
                severity="secondary"
                outlined
                :disabled="drafting"
                @click="draft('cv')"
              />
            </div>
            <details class="job-plan-details">
              <summary><i class="pi pi-angle-right" aria-hidden="true" /> Edit the plan</summary>
              <fieldset :disabled="drafting" class="job-plan-edit">
                <p class="job-muted">
                  Sections and entries come from your CV. Reword highlights freely, one per line, up to the entry’s own
                  count.
                </p>
                <fieldset v-for="(s, i) in editor" :key="s.title" class="job-plan">
                  <legend>
                    <label class="job-check"><input v-model="s.on" type="checkbox" /> {{ s.title }}</label>
                  </legend>
                  <p class="job-plan-move">
                    <Button
                      icon="pi pi-arrow-up"
                      size="small"
                      severity="secondary"
                      text
                      :disabled="i === 0"
                      :aria-label="`Move ${s.title} up`"
                      @click="move(i, -1)"
                    />
                    <Button
                      icon="pi pi-arrow-down"
                      size="small"
                      severity="secondary"
                      text
                      :disabled="i === editor.length - 1"
                      :aria-label="`Move ${s.title} down`"
                      @click="move(i, 1)"
                    />
                  </p>
                  <template v-if="s.on">
                    <div v-for="e in s.entries" :key="e.ref" class="job-plan-entry">
                      <label v-if="e.text === undefined" class="job-check"
                        ><input v-model="e.on" type="checkbox" /> {{ e.label }}</label
                      >
                      <label v-else class="job-field">
                        <span class="job-check"><input v-model="e.on" type="checkbox" /> Line {{ e.ref + 1 }}</span>
                        <InputText v-if="e.on" v-model="e.text" type="text" maxlength="2000" />
                      </label>
                      <label v-if="e.on && e.highlights !== undefined" class="job-field">
                        <span>Highlights (at most {{ e.max }})</span>
                        <Textarea v-model="e.highlights" :rows="Math.max(2, e.max ?? 0)" />
                      </label>
                      <label v-if="e.on && e.details !== undefined" class="job-field">
                        <span>Items (reorder or remove; no new ones)</span>
                        <InputText v-model="e.details" type="text" maxlength="2000" />
                      </label>
                    </div>
                  </template>
                </fieldset>
                <p class="job-actions">
                  <Button label="Save and re-render" icon="pi pi-save" :disabled="drafting" @click="savePlan" />
                </p>
              </fieldset>
            </details>
          </section>

          <section v-if="posting.letter !== null" class="card" aria-labelledby="job-letter">
            <div class="card-head">
              <h2 id="job-letter" class="card-title">
                <i class="pi pi-envelope text-primary" aria-hidden="true" /> Cover letter
              </h2>
              <span class="job-actions">
                <Button label="Copy" icon="pi pi-copy" size="small" severity="secondary" outlined @click="copyLetter" />
                <Button
                  label="Download .txt"
                  icon="pi pi-download"
                  size="small"
                  severity="secondary"
                  outlined
                  @click="downloadLetter"
                />
              </span>
            </div>
            <label class="job-field">
              <span>Letter</span>
              <Textarea
                v-model="letter"
                rows="16"
                maxlength="20000"
                :disabled="drafting"
                class="job-letter"
                @blur="letter !== posting.letter && patch({ letter })"
              />
            </label>
            <div class="job-inline">
              <label class="job-field">
                <span>Regenerate with an instruction</span>
                <InputText
                  v-model="instruction.letter"
                  type="text"
                  maxlength="500"
                  placeholder="e.g. warmer, mention remote work"
                />
              </label>
              <Button
                label="Regenerate letter"
                icon="pi pi-refresh"
                severity="secondary"
                outlined
                :disabled="drafting"
                @click="draft('letter')"
              />
            </div>
          </section>

          <section v-if="posting.ats" class="card" aria-labelledby="job-answers">
            <div class="card-head">
              <div>
                <h2 id="job-answers" class="card-title">
                  <i class="pi pi-list-check text-primary" aria-hidden="true" /> Form answers
                </h2>
                <p class="card-subtitle">Not submitted. Review and copy these into the application.</p>
              </div>
              <Button
                v-if="answers.length"
                label="Copy answers"
                icon="pi pi-copy"
                size="small"
                severity="secondary"
                outlined
                @click="copyAnswers"
              />
            </div>
            <p v-if="!answers.length" class="job-muted">No answers yet.</p>
            <div v-else class="job-table-wrap">
              <table class="job-table">
                <thead>
                  <tr>
                    <th scope="col">Question</th>
                    <th scope="col">Answer</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(a, i) in answers" :key="a.field" :class="{ 'job-handoff': a.source === 'handoff' }">
                    <td>
                      {{ visible(a.question) }}<span v-if="a.required" class="job-req" aria-label="required"> *</span>
                      <small v-if="a.note && a.source === 'handoff'" class="job-hint"
                        ><br />{{ visible(a.note) }}</small
                      >
                    </td>
                    <td>
                      <span v-if="a.source === 'file'" class="job-muted">Uploaded with the application (later)</span>
                      <template v-else>
                        <select
                          v-if="a.options && a.type !== 'multi_value_multi_select'"
                          v-model="a.value"
                          class="job-select"
                          :disabled="drafting"
                          :aria-label="visible(a.question)"
                          @change="saveAnswer(i)"
                        >
                          <option value="">(not answered)</option>
                          <option v-for="o in a.options" :key="o" :value="o">{{ visible(o) }}</option>
                        </select>
                        <Textarea
                          v-else
                          v-model="a.value"
                          rows="2"
                          maxlength="5000"
                          :disabled="drafting"
                          :aria-label="visible(a.question)"
                          @blur="saveAnswer(i)"
                        />
                      </template>
                    </td>
                    <td>
                      <strong v-if="a.source === 'handoff'" class="chip chip-warning">{{ SOURCES[a.source] }}</strong>
                      <span v-else :class="['chip', a.source === 'ai' ? 'chip-info' : 'chip-secondary']">{{
                        SOURCES[a.source]
                      }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="job-inline">
              <label class="job-field">
                <span>Regenerate with an instruction</span>
                <InputText
                  v-model="instruction.answers"
                  type="text"
                  maxlength="500"
                  placeholder="e.g. keep answers short"
                />
              </label>
              <Button
                :label="answers.length ? 'Regenerate answers' : 'Draft answers'"
                icon="pi pi-refresh"
                severity="secondary"
                outlined
                :disabled="drafting"
                @click="draft('answers')"
              />
            </div>
          </section>

          <section class="card" aria-labelledby="job-posting">
            <div class="card-head">
              <h2 id="job-posting" class="card-title">
                <i class="pi pi-file text-primary" aria-hidden="true" /> Posting
              </h2>
            </div>
            <PostingText :text="posting.description" :flags="posting.flags" class="job-posting" />
          </section>
        </div>

        <aside class="job-col job-side">
          <section class="card" aria-labelledby="job-fit">
            <div class="card-head">
              <h2 id="job-fit" class="card-title"><i class="pi pi-chart-bar text-primary" aria-hidden="true" /> Fit</h2>
            </div>
            <p v-if="posting.gate" class="job-note tint-danger">Filtered out: {{ visible(posting.gate) }}</p>
            <p v-if="posting.scoreError" class="job-note tint-danger">
              Scoring failed: {{ visible(posting.scoreError) }}
            </p>
            <div v-if="posting.score === null && !posting.gate && !posting.scoreError" class="empty-state">
              <i class="pi pi-chart-bar" aria-hidden="true" />
              <p>Not scored yet.</p>
            </div>
            <template v-if="posting.score !== null && detail">
              <div class="job-score">
                <span class="job-ring" :style="{ '--v': posting.score }" aria-hidden="true" />
                <p>
                  <strong>{{ posting.score }}</strong> / 100
                </p>
              </div>
              <ul class="job-dims">
                <li v-for="d in DIMENSIONS" :key="d">
                  <span class="job-dim-label">{{ d }}</span>
                  <meter class="job-meter" min="0" max="100" :value="detail[d]" :aria-label="`${d} ${detail[d]}`" />
                  <span class="job-dim-value">{{ detail[d] }}</span>
                </li>
              </ul>
              <p class="job-verdicts">
                <span v-for="v in VERDICTS" :key="v" :class="['chip', `chip-${VERDICT_TINT[detail[v]] ?? 'secondary'}`]"
                  >{{ v }}: {{ detail[v] }}</span
                >
              </p>
              <template v-if="detail.strengths?.length">
                <h3 class="job-subhead">Strengths</h3>
                <ul class="job-points">
                  <li v-for="s in detail.strengths" :key="s">
                    <i class="pi pi-check-circle is-ok" aria-hidden="true" /> <span>{{ visible(s) }}</span>
                  </li>
                </ul>
              </template>
              <template v-if="detail.gaps?.length">
                <h3 class="job-subhead">Gaps</h3>
                <ul class="job-points">
                  <li v-for="g in detail.gaps" :key="g">
                    <i class="pi pi-minus-circle is-gap" aria-hidden="true" /> <span>{{ visible(g) }}</span>
                  </li>
                </ul>
              </template>
              <p v-if="detail.notes" class="job-muted">{{ visible(detail.notes) }}</p>
            </template>
          </section>

          <section class="card" aria-labelledby="job-status">
            <div class="card-head">
              <h2 id="job-status" class="card-title">
                <i class="pi pi-flag text-primary" aria-hidden="true" /> Status
              </h2>
            </div>
            <ol class="job-steps" aria-hidden="true">
              <li
                v-for="(st, n) in PIPELINE"
                :key="st"
                :class="{
                  'is-done': PIPELINE.indexOf(posting.status) > n,
                  'is-current': posting.status === st,
                }"
              >
                <span class="job-step-dot"><i v-if="PIPELINE.indexOf(posting.status) > n" class="pi pi-check" /></span>
                {{ st }}
              </li>
            </ol>
            <label class="job-field">
              <span>Status</span>
              <select
                class="job-select"
                :value="posting.status"
                @change="setStatus($event.target as HTMLSelectElement)"
              >
                <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>
            <label class="job-field">
              <span>Notes</span>
              <Textarea
                v-model="notes"
                rows="4"
                maxlength="20000"
                @blur="notes !== posting.notes && patch({ notes })"
              />
            </label>
          </section>

          <section class="card" aria-labelledby="job-history">
            <div class="card-head">
              <h2 id="job-history" class="card-title">
                <i class="pi pi-history text-primary" aria-hidden="true" /> History
              </h2>
            </div>
            <p v-if="!events.length" class="job-muted">No changes yet.</p>
            <Timeline v-else :value="events" class="job-timeline">
              <template #content="{ item }">
                <div class="job-event">
                  <span class="job-event-kind">{{ item.kind }}</span>
                  <span class="job-event-detail">{{ item.detail && visible(item.detail) }}</span>
                  <span class="job-event-at">{{ when(item.at) }}</span>
                </div>
              </template>
            </Timeline>
          </section>
        </aside>
      </div>

      <div
        v-if="confirming && app"
        v-dialog
        class="job-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adm-apply-confirm"
        @keydown.esc="confirming = false"
      >
        <div class="job-modal-box">
          <h2 id="adm-apply-confirm" class="card-title">Submit this application?</h2>
          <p>
            This sends the form on {{ links()!.host }} with the {{ app.fields.length }} values you checked, usually
            within a few minutes. It can’t be taken back once it is sent.
          </p>
          <div class="job-modal-actions">
            <Button label="Cancel" severity="secondary" outlined data-autofocus @click="confirming = false" />
            <Button icon="pi pi-send" label="Approve and submit" @click="approveNow" />
          </div>
        </div>
      </div>
    </template>
  </AdminShell>
</template>

<style scoped>
.job-tabs.adm-tablinks {
  gap: 0 0.5rem;
  margin-block: -0.75rem 1.5rem;
  border-block-end: 1px solid var(--app-border);
}
.job-tabs.adm-tablinks :deep(a) {
  min-height: 2.75rem;
  padding-inline: 0.875rem;
  color: var(--app-body);
  font-size: 0.9375rem;
  font-weight: 500;
}
.job-tabs.adm-tablinks :deep(a:hover) {
  color: var(--p-primary-color);
}
.job-tabs.adm-tablinks :deep(a[aria-current='page']) {
  border-block-end-color: var(--p-primary-color);
  color: var(--p-primary-color);
}
.job-tabs.adm-tablinks :deep(.adm-count) {
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

/* Summary strip. */
.job-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem 1.25rem;
  margin-block-end: 1rem;
}
.job-logo {
  display: grid;
  flex: none;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #8c78fe 0%, #5f4afe 100%);
  color: #fff;
  font-size: 1.5rem;
  font-weight: 700;
}
.job-hero-main {
  display: grid;
  flex: 1 1 18rem;
  gap: 0.5rem;
  min-width: 0;
}
.job-hero-meta {
  margin: 0;
  color: var(--app-body);
  font-size: 0.9375rem;
}
.job-hero-meta strong {
  color: var(--app-heading);
  font-weight: 600;
}
.job-hero-meta .pi {
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.job-hero-chips,
.job-hero-actions,
.job-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.job-actions {
  margin: 1.25rem 0 0;
}
.card-head .job-actions {
  margin: 0;
}

/* Two columns: the work on the left, score, status and history on the right. */
.job-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
  align-items: start;
  gap: 1rem;
}
.job-col {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
@media (max-width: 1199.98px) {
  .job-grid {
    grid-template-columns: 1fr;
  }
  .job-side {
    grid-row: 1;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    align-items: start;
  }
}
.card-title[id] {
  scroll-margin-block-start: calc(var(--app-header-height) + 1rem);
}
.card > .card-head {
  margin-block-end: 1rem;
}

/* Text. */
.job-lead {
  margin: 0;
  color: var(--app-body);
  font-size: 0.875rem;
}
.job-muted,
.job-hint {
  margin: 0;
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.job-muted + *,
.job-lead + *,
* + .job-muted {
  margin-block-start: 0.875rem;
}
.job-subhead {
  margin: 1.25rem 0 0.5rem;
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
}
.job-req {
  color: var(--c-danger);
}
.job-note {
  display: flex;
  gap: 0.5rem;
  margin: 0.875rem 0 0;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  color: var(--app-heading);
  font-size: 0.875rem;
}
.card-head + .job-note,
.card-head + div.job-note {
  margin-block-start: 0;
}
.job-note ul {
  margin: 0.375rem 0 0;
  padding-inline-start: 1.125rem;
}
.job-note.tint-warning {
  box-shadow: inset 3px 0 0 var(--c-warning);
}
.job-note.tint-danger {
  box-shadow: inset 3px 0 0 var(--c-danger);
}
.job-note.tint-info {
  box-shadow: inset 3px 0 0 var(--c-info);
}
.job-note.tint-success {
  box-shadow: inset 3px 0 0 var(--c-success);
}
.job-note .pi {
  margin-block-start: 0.1875rem;
}

/* Fields. */
.job-field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
  margin-block-start: 1rem;
}
.job-field > span:first-child,
.job-label {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.job-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
  margin-block-start: 1.25rem;
  padding-block-start: 1.25rem;
  border-top: 1px dashed var(--app-border);
}
.job-inline .job-field {
  flex: 1 1 16rem;
  margin: 0;
}
.job-select,
.adm .job-col :is(input.p-inputtext, textarea.p-textarea) {
  width: 100%;
  padding: var(--p-inputtext-padding-y, 0.5rem) var(--p-inputtext-padding-x, 0.75rem);
  border: 1px solid var(--p-inputtext-border-color, var(--app-border));
  border-radius: var(--p-inputtext-border-radius, 6px);
  background: var(--p-inputtext-background, var(--app-card));
  color: var(--p-inputtext-color, var(--app-heading));
  font: inherit;
  font-size: 0.9375rem;
  transition: border-color 0.15s;
}
.job-select:enabled:hover,
.adm .job-col :is(input.p-inputtext, textarea.p-textarea):enabled:hover {
  border-color: var(--p-inputtext-hover-border-color, var(--app-muted));
}
.job-select:focus,
.adm .job-col :is(input.p-inputtext, textarea.p-textarea):enabled:focus {
  border-color: var(--p-inputtext-focus-border-color, var(--p-primary-color));
}
.job-select:disabled,
.adm .job-col :is(input.p-inputtext, textarea.p-textarea):disabled {
  background: var(--p-inputtext-disabled-background, var(--app-canvas));
  color: var(--p-inputtext-disabled-color, var(--app-muted));
}
.job-select {
  appearance: none;
  padding-inline-end: 2.25rem;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--app-muted) 50%),
    linear-gradient(135deg, var(--app-muted) 50%, transparent 50%);
  background-position:
    calc(100% - 1.125rem) 50%,
    calc(100% - 0.8125rem) 50%;
  background-size: 0.3125rem 0.3125rem;
  background-repeat: no-repeat;
}
.adm .job-col textarea.p-textarea {
  resize: vertical;
}
.job-letter {
  font-family: var(--font-serif);
  font-size: 0.9375rem !important;
  line-height: 1.6;
}
.job-check {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--app-heading);
  font-size: 0.875rem;
}
.job-check input {
  width: 1.125rem;
  height: 1.125rem;
  accent-color: var(--p-primary-color);
}

/* Application form fields. */
.job-fields,
.job-rows {
  margin: 0.875rem 0 0;
  padding: 0;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
  list-style: none;
}
.job-fields > li {
  display: grid;
  gap: 0.375rem;
  padding: 0.875rem 1rem;
}
.job-fields > li + li,
.job-rows > li + li {
  border-top: 1px solid var(--app-border);
}
.job-field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 0.75rem;
}
.job-file {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--app-body);
  font-size: 0.875rem;
}
.job-file .pi {
  color: var(--c-danger);
}
.job-rows > li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}
.job-row-main {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
}
.job-value {
  white-space: pre-wrap;
}
.job-shots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0.875rem 0 0;
  padding: 0;
  list-style: none;
}
.job-shots img,
.job-shot img {
  display: block;
  width: 220px;
  max-width: 100%;
  height: 150px;
  border: 1px solid var(--app-border);
  border-radius: 0.5rem;
  background: var(--app-canvas);
  object-fit: cover;
  object-position: top;
}
.job-shot {
  display: inline-block;
  margin-block-start: 0.875rem;
}

/* Tailored CV. */
.job-reqs ul,
.job-points {
  display: grid;
  gap: 0.375rem;
  margin: 0.625rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.875rem;
}
.job-reqs li,
.job-points li {
  display: flex;
  gap: 0.5rem;
}
.job-reqs .pi,
.job-points .pi {
  margin-block-start: 0.1875rem;
}
.is-ok {
  color: var(--c-success);
}
.is-cut {
  color: var(--c-warning);
}
.is-gap {
  color: var(--c-danger);
}
.job-pdf {
  width: 100%;
  height: 70vh;
  margin-block-start: 1rem;
  border: 1px solid var(--app-border);
  border-radius: 0.5rem;
  background: var(--app-canvas);
}
.job-plan-details {
  margin-block-start: 1.25rem;
  border-top: 1px dashed var(--app-border);
}
.job-plan-details > summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-block: 1rem 0;
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
  list-style: none;
  cursor: pointer;
}
.job-plan-details > summary::-webkit-details-marker {
  display: none;
}
.job-plan-details > summary .pi {
  color: var(--app-muted);
  font-size: 0.75rem;
  transition: transform 0.15s;
}
.job-plan-details[open] > summary .pi {
  transform: rotate(90deg);
}
.job-plan-edit {
  min-width: 0;
  margin: 0.75rem 0 0;
  padding: 0;
  border: 0;
}
.job-plan {
  position: relative;
  min-width: 0;
  margin: 0.75rem 0 0;
  padding: 0.75rem 1rem 1rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
}
.job-plan > legend {
  padding-inline: 0.375rem;
  font-weight: 600;
}
.job-plan-move {
  position: absolute;
  inset-block-start: 0.25rem;
  inset-inline-end: 0.5rem;
  display: flex;
  margin: 0;
}
.job-plan-entry {
  display: grid;
  gap: 0.25rem;
  padding-block: 0.5rem;
}
.job-plan-entry + .job-plan-entry {
  border-top: 1px dashed var(--app-border);
}
.job-plan-entry .job-field {
  margin-block-start: 0.375rem;
}

/* Form answers. */
.job-table-wrap {
  margin-inline: -1.5rem;
  overflow-x: auto;
}
.job-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.job-table th {
  padding: 0.75rem 1rem;
  background: var(--app-canvas);
  color: var(--app-heading);
  font-weight: 500;
  text-align: start;
}
.job-table th:first-child,
.job-table td:first-child {
  padding-inline-start: 1.5rem;
}
.job-table th:last-child,
.job-table td:last-child {
  padding-inline-end: 1.5rem;
}
.job-table td {
  padding: 0.875rem 1rem;
  border-top: 1px solid var(--app-border);
  color: var(--app-heading);
  vertical-align: top;
}
.job-table td:nth-child(2) {
  min-width: 14rem;
}
.job-handoff td {
  background: color-mix(in srgb, var(--c-warning) 7%, transparent);
}

/* Posting text. */
.job-posting :deep(.adm-job-text) {
  color: var(--app-body);
  font-size: 0.9375rem;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.job-posting :deep(.adm-err) {
  margin-block-end: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--c-danger) 8%, transparent);
  box-shadow: inset 3px 0 0 var(--c-danger);
  color: var(--app-heading);
  font-size: 0.8125rem;
}
.job-posting :deep(.adm-err p) {
  margin: 0 0 0.375rem;
  color: var(--c-danger);
  font-weight: 600;
}
.job-posting :deep(.adm-err ul) {
  margin: 0.25rem 0 0.5rem;
  padding-inline-start: 1.125rem;
}

/* Fit. */
.job-score {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.job-ring {
  --v: 0;
  display: block;
  flex: none;
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 50%;
  background: conic-gradient(var(--p-primary-color) calc(var(--v) * 1%), var(--app-canvas) 0);
  mask: radial-gradient(circle, transparent 58%, #000 59%);
}
.job-score p {
  margin: 0;
  color: var(--app-muted);
  font-size: 0.9375rem;
}
.job-score strong {
  color: var(--app-heading);
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.job-dims {
  display: grid;
  gap: 0.75rem;
  margin: 1.25rem 0 0;
  padding: 0;
  list-style: none;
}
.job-dims li {
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 1fr) 2rem;
  align-items: center;
  gap: 0.75rem;
}
.job-dim-label {
  color: var(--app-heading);
  font-size: 0.8125rem;
  font-weight: 500;
  text-transform: capitalize;
}
.job-dim-value {
  color: var(--app-body);
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
.job-meter {
  width: 100%;
  height: 0.375rem;
  border: 0;
  border-radius: 999px;
  background: var(--app-canvas);
  appearance: none;
}
.job-meter::-webkit-meter-bar {
  height: 0.375rem;
  border: 0;
  border-radius: 999px;
  background: var(--app-canvas);
}
.job-meter::-webkit-meter-optimum-value,
.job-meter::-webkit-meter-suboptimum-value,
.job-meter::-webkit-meter-even-less-good-value {
  border-radius: 999px;
  background: var(--p-primary-color);
}
.job-meter::-moz-meter-bar {
  border-radius: 999px;
  background: var(--p-primary-color);
}
.job-verdicts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin: 1.25rem 0 0;
}
.job-points {
  font-size: 0.8125rem;
}
.job-points + .job-muted {
  margin-block-start: 1rem;
}

/* Status: the usual path, then the select. */
.job-steps {
  display: grid;
  gap: 0;
  margin: 0 0 0.25rem;
  padding: 0;
  list-style: none;
}
.job-steps li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-block: 0.3125rem;
  color: var(--app-muted);
  font-size: 0.875rem;
  text-transform: capitalize;
}
.job-steps li + li::before {
  content: '';
  position: absolute;
  inset-block-start: -0.4375rem;
  inset-inline-start: 0.5625rem;
  width: 2px;
  height: 0.875rem;
  background: var(--app-border);
}
.job-steps li.is-done + li::before {
  background: var(--c-success);
}
.job-step-dot {
  display: grid;
  flex: none;
  place-items: center;
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid var(--app-border);
  border-radius: 50%;
  background: var(--app-card);
  font-size: 0.625rem;
}
.job-steps .is-done {
  color: var(--app-body);
}
.job-steps .is-done .job-step-dot {
  border-color: var(--c-success);
  background: var(--c-success);
  color: #fff;
}
.job-steps .is-current {
  color: var(--p-primary-color);
  font-weight: 600;
}
.job-steps .is-current .job-step-dot {
  border-color: var(--p-primary-color);
  box-shadow: inset 0 0 0 3px var(--app-card);
  background: var(--p-primary-color);
}

/* History. */
.job-timeline {
  margin-block-start: -0.25rem;
}
.job-timeline :deep(.p-timeline-event-opposite) {
  flex: 0;
  padding: 0;
}
.job-timeline :deep(.p-timeline-event-marker) {
  border-color: var(--p-primary-color);
}
.job-timeline :deep(.p-timeline-event-content) {
  padding-block-end: 1rem;
}
.job-event {
  display: grid;
  gap: 0.125rem;
  font-size: 0.8125rem;
}
.job-event-kind {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: capitalize;
}
.job-event-detail {
  color: var(--app-body);
  overflow-wrap: anywhere;
}
.job-event-at {
  color: var(--app-muted);
  font-size: 0.75rem;
}

/* Confirm. */
.job-modal {
  position: fixed;
  inset: 0;
  z-index: 1101;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(25 24 34 / 0.45);
  backdrop-filter: blur(2px);
}
.job-modal-box {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: min(560px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 1.5rem;
  border-radius: var(--app-radius-card);
  background: var(--app-card);
  box-shadow: var(--app-shadow-float);
}
.job-modal-box p {
  margin: 0;
}
.job-modal-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (max-width: 575.98px) {
  .job-logo {
    width: 2.75rem;
    height: 2.75rem;
    font-size: 1.125rem;
  }
  .job-hero-main {
    flex-basis: calc(100% - 4rem);
  }
}
@media (max-width: 767.98px) {
  .job-hero-actions {
    width: 100%;
  }
  .job-table-wrap {
    margin-inline: -1.5rem;
  }
  .job-table td:nth-child(2) {
    min-width: 12rem;
  }
  .job-dims li {
    grid-template-columns: 5.5rem minmax(0, 1fr) 2rem;
  }
}
</style>
