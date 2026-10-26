<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import ProgressBar from 'primevue/progressbar';
import { ApiError, api, report } from './api';
import { vDialog } from './dialog';
import { FIELD_LABELS, defaultTicked, displayValue, sourceLabel } from './paper-review';
import type { Completable, PaperProposal } from '../lib/admin/paper-complete';

const emit = defineEmits<{ close: [] }>();
const STEP = 10;

interface Block {
  proposal: PaperProposal;
  ticked: Record<string, boolean>;
  busy: boolean;
  message: string;
  stale: boolean;
}
const blocks = ref<Block[]>([]);
const total = ref(0);
const checked = ref(0);
const loading = ref(false);
let run = 0;

const block = (proposal: PaperProposal): Block =>
  reactive({
    proposal,
    ticked: Object.fromEntries(proposal.changes.map((c) => [c.field, defaultTicked(c)])),
    busy: false,
    message: '',
    stale: false,
  });

async function load() {
  const mine = ++run;
  blocks.value = [];
  checked.value = 0;
  loading.value = true;
  try {
    let offset = 0;
    do {
      const r = await api<{ total: number; offset: number; proposals: PaperProposal[] }>(
        `papers/complete?offset=${offset}&limit=${STEP}`,
      );
      if (mine !== run) return;
      total.value = r.total;
      blocks.value.push(...r.proposals.map(block));
      // A batch that moves nowhere would loop for ever.
      if (r.offset <= offset) break;
      offset = r.offset;
      checked.value = Math.min(offset, r.total);
    } while (offset < total.value);
  } catch (e) {
    if (mine === run) report(e);
  } finally {
    if (mine === run) loading.value = false;
  }
}

async function apply(b: Block) {
  b.busy = true;
  b.message = '';
  const pick = (on: boolean) => b.proposal.changes.filter((c) => !!b.ticked[c.field] === on);
  try {
    const next = await api<PaperProposal>('papers/complete', {
      method: 'POST',
      body: {
        slug: b.proposal.slug,
        apply: pick(true).map((c) => ({ field: c.field, value: c.to, from: c.from })),
        decline: pick(false).map((c) => ({ field: c.field, value: c.to })),
      },
    });
    Object.assign(b, block(next));
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      b.message = e.message;
      b.stale = true;
    } else b.message = e instanceof Error ? e.message : String(e);
  } finally {
    b.busy = false;
  }
}

const withChanges = computed(() => blocks.value.filter((b) => b.proposal.changes.length));
const failed = computed(() => blocks.value.filter((b) => b.proposal.error || b.proposal.noMatch));
const upToDate = computed(() => blocks.value.length - withChanges.value.length - failed.value.length);
const long = (f: Completable) => f === 'abstract' || f === 'bibtex';

onMounted(load);
onBeforeUnmount(() => run++);
</script>

<template>
  <div
    v-dialog
    class="pr-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Complete papers"
    @keydown.esc="emit('close')"
  >
    <div class="pr-box">
      <div class="pr-head">
        <span class="pr-icon tint-primary" aria-hidden="true"><i class="pi pi-sparkles" /></span>
        <h2 class="card-title">Complete papers from their sources</h2>
        <Button label="Close" icon="pi pi-times" size="small" severity="secondary" text @click="emit('close')" />
      </div>
      <div class="pr-body">
        <p class="pr-lead">
          Empty fields are ticked. Changes to what you have are not; tick the ones you want. Unticked changes won't be
          offered again.
        </p>
        <div v-if="loading" class="pr-progress">
          <p class="pr-muted" role="status">Checking papers… {{ checked }} of {{ total }}</p>
          <ProgressBar
            :value="total ? Math.round((checked / total) * 100) : 0"
            :show-value="false"
            aria-hidden="true"
            class="pr-bar"
          />
        </div>
        <p v-else class="pr-muted" role="status">
          <i class="pi pi-check-circle" aria-hidden="true" /> Checked {{ blocks.length }} papers. {{ upToDate }} up to
          date.
        </p>
        <section v-for="b in withChanges" :key="b.proposal.slug" class="pr-card" :aria-label="b.proposal.title">
          <h3 class="pr-title">{{ b.proposal.title }}</h3>
          <ul class="pr-changes">
            <li v-for="c in b.proposal.changes" :key="c.field">
              <label class="pr-check">
                <Checkbox v-model="b.ticked[c.field]" binary :disabled="b.busy" />
                <strong>{{ FIELD_LABELS[c.field] }}</strong>
                <span v-if="c.source" class="chip chip-secondary"> from {{ sourceLabel(c.source) }}</span>
              </label>
              <div class="pr-pair">
                <div class="pr-side">
                  <span class="pr-side-label">Now</span>
                  <pre v-if="long(c.field)" class="pr-text pr-long">{{ displayValue(c.field, c.from) }}</pre>
                  <span v-else class="pr-text">{{ displayValue(c.field, c.from) }}</span>
                </div>
                <div class="pr-side is-new">
                  <span class="pr-side-label">Proposed</span>
                  <pre v-if="long(c.field)" class="pr-text pr-long">{{ displayValue(c.field, c.to) }}</pre>
                  <span v-else class="pr-text">{{ displayValue(c.field, c.to) }}</span>
                </div>
              </div>
            </li>
          </ul>
          <p v-if="b.message" class="pr-err" role="alert">
            {{ b.message }}
            <Button
              v-if="b.stale"
              label="Reload the review"
              icon="pi pi-refresh"
              size="small"
              severity="secondary"
              outlined
              @click="load"
            />
          </p>
          <div class="pr-actions">
            <Button
              icon="pi pi-check"
              :label="b.busy ? 'Applying…' : 'Apply selected'"
              :loading="b.busy"
              :disabled="b.busy"
              @click="apply(b)"
            />
          </div>
        </section>
        <section v-if="failed.length" class="pr-failed" aria-label="Couldn't complete">
          <h3 class="pr-title">Couldn't complete</h3>
          <ul>
            <li v-for="b in failed" :key="b.proposal.slug" class="list-row">
              <span class="pr-failed-text"
                >{{ b.proposal.title }}:
                <span class="pr-muted">{{ b.proposal.error ?? 'No matching record found' }}</span></span
              >
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pr-modal {
  position: fixed;
  inset: 0;
  z-index: 1101;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(25 24 34 / 0.45);
  backdrop-filter: blur(2px);
}
.pr-box {
  display: flex;
  flex-direction: column;
  width: min(820px, 100%);
  max-height: 90vh;
  overflow: hidden;
  border-radius: var(--app-radius-card);
  background: var(--app-card);
  box-shadow: var(--app-shadow-float);
}
.pr-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem 1rem 1.5rem;
  border-bottom: 1px solid var(--app-border);
}
.pr-head .card-title {
  flex: 1;
  min-width: 0;
}
.pr-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  font-size: 1.05rem;
}
.pr-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 1.5rem 1.5rem;
  overflow: auto;
}
.pr-lead {
  margin: 0;
  color: var(--app-body);
  font-size: 0.875rem;
}
.pr-muted {
  margin: 0;
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.pr-muted .pi {
  color: var(--c-success);
}
.pr-progress {
  display: grid;
  gap: 0.5rem;
}
.pr-bar {
  height: 0.375rem;
}
.pr-card {
  padding: 1rem 1.25rem 1.25rem;
  border: 1px solid var(--app-border);
  border-radius: 0.625rem;
}
.pr-title {
  margin: 0 0 0.75rem;
  color: var(--app-heading);
  font-size: 0.9375rem;
  font-weight: 600;
}
.pr-changes {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pr-changes > li + li {
  padding-block-start: 1rem;
  border-top: 1px dashed var(--app-border);
}
.pr-check {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  color: var(--app-heading);
  font-size: 0.875rem;
  cursor: pointer;
}
.pr-pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.5rem;
  margin-block-start: 0.625rem;
}
.pr-side {
  display: grid;
  align-content: start;
  gap: 0.25rem;
  min-width: 0;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--app-canvas);
}
.pr-side.is-new {
  background: color-mix(in srgb, var(--c-success) 8%, transparent);
}
.pr-side-label {
  color: var(--app-muted);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.pr-text {
  color: var(--app-heading);
  font-size: 0.8125rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.pr-long {
  max-height: 160px;
  margin: 0;
  overflow: auto;
  font-family: inherit;
}
.pr-err {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin: 1rem 0 0;
  padding: 0.625rem 0.875rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--c-danger) 8%, transparent);
  color: var(--c-danger);
  font-size: 0.8125rem;
}
:global(.app-dark) .pr-err {
  color: #ff7b72;
}
.pr-actions {
  display: flex;
  justify-content: flex-end;
  margin-block-start: 1rem;
}
.pr-failed ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.pr-failed-text {
  color: var(--app-heading);
  font-size: 0.875rem;
}
</style>
