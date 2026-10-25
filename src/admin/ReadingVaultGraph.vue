<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Skeleton from 'primevue/skeleton';
import AdminShell from './AdminShell.vue';
import ReadingNav from './ui/reading/ReadingNav.vue';
import { KIND_LOOK } from './ui/reading/sources';
import NoteGraph from '../components/vue/NoteGraph.vue';
import { api, report } from './api';
import { visible } from './career';
import { plural } from './status';
import { KIND_NAMES } from './vault';
import type { AdminCtx } from './types';
import type { NoteRow } from '../lib/reading/types';

// Titles may come from a paper's title: shown with {{ }} and attributes only, never as HTML.
const props = defineProps<{ ctx: AdminCtx }>();
const base = `/${props.ctx.adminPath}`;
const open = (id: number) => `${base}/reading/vault/${id}`;

type GraphNode = NoteRow & { links: number };

const nodes = ref<GraphNode[] | null>(null);
const edges = ref<[number, number][]>([]); // node indexes
const total = ref(0);
const selected = ref<number | null>(null);
const graphNodes = computed(() => (nodes.value ?? []).map((n) => ({ ...n, href: open(n.id) })));

const neighbourRows = computed(() => {
  const s = selected.value;
  if (s === null || !nodes.value) return [];
  return edges.value
    .flatMap(([a, b]) => (a === s ? [b] : b === s ? [a] : []))
    .map((i) => nodes.value![i])
    .sort((a, b) => a.title.localeCompare(b.title));
});

onMounted(async () => {
  try {
    const g = await api<{ nodes: GraphNode[]; edges: [number, number][]; total: number }>('reading/vault/graph');
    const index = new Map(g.nodes.map((n, i) => [n.id, i]));
    const kept = g.edges.flatMap(([a, b]): [number, number][] => {
      const [i, j] = [index.get(a), index.get(b)];
      return i === undefined || j === undefined ? [] : [[i, j]];
    });
    edges.value = kept;
    total.value = g.total;
    nodes.value = g.nodes;
  } catch (e) {
    report(e);
  }
});
</script>

<template>
  <AdminShell :ctx="ctx" active="reading/vault" title="Graph">
    <ReadingNav :base="base" current="vault" />

    <section class="card rd-graph">
      <div class="card-head">
        <Button
          as="a"
          :href="`${base}/reading/vault`"
          label="Vault"
          icon="pi pi-arrow-left"
          severity="secondary"
          text
          size="small"
          class="rd-back"
        />
        <ul v-if="nodes?.length" class="rd-legend" aria-label="Legend">
          <li><span class="rd-shape is-paper" aria-hidden="true" />Circle: paper</li>
          <li><span class="rd-shape is-free" aria-hidden="true" />Square: note</li>
          <li><span class="rd-shape is-chat" aria-hidden="true" />Diamond: chat</li>
        </ul>
      </div>

      <template v-if="!nodes">
        <p class="adm-visually-hidden">Loading…</p>
        <Skeleton height="420px" />
      </template>
      <template v-else>
        <p class="rd-graph-line">
          <template v-if="!edges.length">No links yet. Link notes with [[ ]] and they show here.</template>
          <template v-else>{{ plural(nodes.length, 'note') }}, {{ plural(edges.length, 'link') }}.</template>
          <template v-if="total > nodes.length">
            Showing the {{ nodes.length }} most-linked of {{ total }} notes.
          </template>
        </p>

        <template v-if="nodes.length">
          <div class="rd-graph-canvas">
            <NoteGraph v-model:selected="selected" :nodes="graphNodes" :edges="edges" />
          </div>

          <div class="rd-graph-strip" aria-live="polite">
            <template v-if="selected !== null">
              <p class="rd-graph-picked">
                <span :class="['rd-kind-icon', `tint-${KIND_LOOK[nodes[selected].kind].tint}`]" aria-hidden="true"
                  ><i :class="['pi', KIND_LOOK[nodes[selected].kind].icon]"
                /></span>
                <a :href="open(nodes[selected].id)" dir="auto">{{ visible(nodes[selected].title) }}</a>
                <span class="rd-graph-sub">
                  · {{ KIND_NAMES[nodes[selected].kind] }} · {{ plural(nodes[selected].links, 'link') }}</span
                >
              </p>
              <ul v-if="neighbourRows.length" class="rd-graph-neighbours">
                <li v-for="n in neighbourRows" :key="n.id">
                  <a :href="open(n.id)" class="chip chip-secondary" dir="auto">{{ visible(n.title) }}</a>
                </li>
              </ul>
            </template>
          </div>
        </template>
      </template>
    </section>
  </AdminShell>
</template>

<style scoped>
.rd-graph {
  --graph-ink: var(--app-heading);
  --graph-muted: var(--c-pink);
  --graph-rule: color-mix(in srgb, var(--app-muted) 45%, transparent);
  --graph-accent: var(--c-primary);
  --graph-paper: var(--app-card);
}
.rd-back {
  margin-inline-start: -0.75rem;
}
.rd-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.rd-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}
.rd-shape {
  display: inline-block;
  width: 0.625rem;
  height: 0.625rem;
}
.rd-shape.is-paper {
  border-radius: 50%;
  background: var(--graph-accent);
}
.rd-shape.is-free {
  background: var(--graph-ink);
}
.rd-shape.is-chat {
  background: var(--graph-muted);
  transform: rotate(45deg) scale(0.85);
}
.rd-graph-line {
  margin: 0 0 1rem;
  color: var(--app-body);
  font-size: 0.875rem;
}
.rd-graph-canvas :deep(svg) {
  border-color: var(--app-border);
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--app-canvas) 55%, transparent);
}
.rd-graph-strip {
  min-height: 3rem;
  margin-block-start: 1rem;
}
.rd-graph-picked {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
  margin: 0 0 0.5rem;
}
.rd-graph-picked a {
  color: var(--app-heading);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.rd-kind-icon {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  font-size: 0.8125rem;
}
.rd-graph-sub {
  color: var(--app-muted);
  font-size: 0.875rem;
}
.rd-graph-neighbours {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rd-graph-neighbours a {
  min-height: 2rem;
  padding-inline: 0.75rem;
  white-space: normal;
  overflow-wrap: anywhere;
  text-decoration: none;
}
.rd-graph-neighbours a:hover {
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
}
</style>
