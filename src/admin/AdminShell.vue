<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onErrorCaptured, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Menu from 'primevue/menu';
import Popover from 'primevue/popover';
import { api, dismissToast, report, session, toasts, type Toast } from './api';
import { vDialog } from './dialog';
import { siteStatus, type DashboardData, type StatusRow } from './status';
import type { AdminCtx } from './types';

/**
 * The admin frame (Sakai's layout, Conca's look): sidebar with grouped menu, header with search, notifications, theme
 * and account menus, the page title with its actions, and the toasts. `narrow`: a reading-width page. `dirty`: the open
 * document has unsaved changes. `badges`: a count beside a sidebar link, by its path.
 */
const props = defineProps<{
  ctx: AdminCtx;
  active: string;
  title: string;
  narrow?: boolean;
  dirty?: boolean;
  badges?: Record<string, number>;
}>();
const base = `/${props.ctx.adminPath}`;
session.mode = props.ctx.mode;
const banner = ref('');
const href = (path: string) => (path ? `${base}/${path}` : base);
// CV styles shares CV's place in the menu.
const current = computed(() => (props.active === 'cv-styles' ? 'cv' : props.active));

interface Link {
  path: string;
  label: string;
  icon: string;
}
interface Group {
  label: string;
  links: Link[];
  /** A collapsible sub-menu under the group's links. */
  more?: { label: string; icon: string; links: Link[] };
}
const L = (path: string, label: string, icon: string): Link => ({ path, label, icon });

// What contributors edit most comes first, site-wide setup last.
const GROUPS = computed<Group[]>(() => {
  const postgres = props.ctx.mode === 'postgres';
  const owner = props.ctx.isOwner && postgres;
  return [
    {
      label: 'Overview',
      links: [L('', 'Dashboard', 'pi-th-large'), ...(postgres ? [L('analytics', 'Analytics', 'pi-chart-line')] : [])],
    },
    {
      label: 'Content',
      links: [
        L('posts', 'Blog posts', 'pi-pencil'),
        L('content/announcements', 'News', 'pi-megaphone'),
        L('publications', 'Publications', 'pi-book'),
        L('cv', 'CV', 'pi-id-card'),
        L('content/people', 'People', 'pi-users'),
      ],
      more: {
        label: 'Projects, talks, positions',
        icon: 'pi-folder',
        links: [
          L('content/projects', 'Projects', 'pi-box'),
          L('content/talks', 'Talks', 'pi-microphone'),
          L('content/positions', 'Positions', 'pi-briefcase'),
        ],
      },
    },
    ...(owner
      ? [
          { label: 'Career', links: [L('career', 'Job search', 'pi-briefcase')] },
          {
            label: 'Reading',
            links: [
              L('reading', 'Today', 'pi-sun'),
              L('reading/library', 'Library', 'pi-bookmark'),
              L('reading/notebooks', 'Notebooks', 'pi-file-edit'),
              L('reading/vault', 'Vault', 'pi-database'),
              L('reading/settings', 'Reading settings', 'pi-sliders-h'),
            ],
          },
        ]
      : []),
    {
      label: 'Site',
      links: [
        L('pages', 'Pages', 'pi-file'),
        L('media', 'Media', 'pi-images'),
        L('editor', 'Site editor', 'pi-sparkles'),
      ],
    },
    {
      label: 'Setup',
      links: [
        L('settings', 'Settings', 'pi-cog'),
        L('ai', 'Integrations', 'pi-objects-column'),
        ...(postgres ? [L('users', 'Users', 'pi-user')] : []),
      ],
    },
  ];
});
/** A menu link's count: the page's own, else the job search's ready count from `me`. */
function badge(path: string) {
  return props.badges?.[path] ?? (path === 'career' ? session.careerReady : null);
}
const moreOpen = ref<Record<string, boolean>>({});
const isMoreOpen = (g: Group) => moreOpen.value[g.label] ?? g.more?.links.some((l) => l.path === current.value);
const groupOf = computed(
  () =>
    GROUPS.value.find((g) => [...g.links, ...(g.more?.links ?? [])].some((l) => l.path === current.value))?.label ?? '',
);

// Sidebar: collapsed to icons on desktop (remembered), off-canvas on screens under 1200px.
const collapsed = ref(false);
const mobileOpen = ref(false);
const desktop = () => window.matchMedia('(min-width: 1200px)').matches;
function toggleMenu() {
  if (desktop()) {
    collapsed.value = !collapsed.value;
    try {
      localStorage.setItem('adm-sidebar', collapsed.value ? 'collapsed' : 'open');
    } catch {
      // private mode: the choice lasts until reload
    }
  } else mobileOpen.value = !mobileOpen.value;
}

// Theme: light, dark or the system's, applied as `.app-dark` on <html> (set before paint by the page's inline script).
type ThemeChoice = 'light' | 'dark' | 'system';
const themeChoice = ref<ThemeChoice>('system');
const themeMenu = ref<InstanceType<typeof Menu> | null>(null);
const media = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = themeChoice.value === 'dark' || (themeChoice.value === 'system' && media.matches);
  document.documentElement.classList.toggle('app-dark', dark);
}
function setTheme(choice: ThemeChoice) {
  themeChoice.value = choice;
  try {
    localStorage.setItem('adm-theme', choice);
  } catch {
    // private mode
  }
  applyTheme();
}
const themeItems = computed(() =>
  (
    [
      ['light', 'Light', 'pi-sun'],
      ['dark', 'Dark', 'pi-moon'],
      ['system', 'System', 'pi-desktop'],
    ] as const
  ).map(([value, label, icon]) => ({
    label,
    icon: `pi ${icon}`,
    class: themeChoice.value === value ? 'is-chosen' : '',
    command: () => setTheme(value),
  })),
);
const themeIcon = computed(() =>
  themeChoice.value === 'system' ? 'pi-desktop' : themeChoice.value === 'dark' ? 'pi-moon' : 'pi-sun',
);

// Account menu.
const userMenu = ref<InstanceType<typeof Menu> | null>(null);
const login = computed(() => props.ctx.user?.login ?? '');
const displayName = computed(() => props.ctx.user?.name || login.value || 'Admin');
const initials = computed(
  () =>
    displayName.value
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || 'A',
);
const role = computed(() => (props.ctx.isOwner ? 'Owner' : 'Admin'));
const userItems = computed(() => [
  { label: displayName.value, items: [] as unknown[], class: 'is-header' },
  ...(props.ctx.mode === 'postgres' ? [{ label: 'Users', icon: 'pi pi-user', url: href('users') }] : []),
  { label: 'Settings', icon: 'pi pi-cog', url: href('settings') },
  { label: 'View site', icon: 'pi pi-external-link', url: '/', target: '_blank' },
  { separator: true },
  { label: 'Sign out', icon: 'pi pi-sign-out', command: () => void signOut() },
]);

// Notifications: the site-status rows that need attention or carry a suggestion. Postgres mode reads them at once
// (a cheap query); git mode asks GitHub, so only when the bell is opened.
const bell = ref<InstanceType<typeof Popover> | null>(null);
const notices = ref<StatusRow[] | null>(null);
const loadingNotices = ref(false);
async function loadNotices() {
  if (loadingNotices.value) return;
  loadingNotices.value = true;
  try {
    const d = await api<DashboardData>('dashboard');
    notices.value = siteStatus(d).filter((r) => r.tone === 'attention' || r.tone === 'nudge');
  } catch {
    notices.value = notices.value ?? [];
  } finally {
    loadingNotices.value = false;
  }
}
const attention = computed(() => notices.value?.filter((r) => r.tone === 'attention').length ?? 0);
function openBell(e: Event) {
  bell.value?.toggle(e);
  if (!notices.value) void loadNotices();
}

// Jump to: every menu destination plus the create actions, filtered by a case-insensitive substring.
const DESTINATIONS = computed(() => [
  ...GROUPS.value.flatMap((g) =>
    [...g.links, ...(g.more?.links ?? [])].map((l) => ({ path: l.path, label: l.label, group: g.label })),
  ),
  { path: 'posts/new', label: 'New blog post', group: 'Create' },
  { path: 'content/announcements?new', label: 'New news item', group: 'Create' },
  { path: 'publications?new', label: 'New publication', group: 'Create' },
]);
const jumpOpen = ref(false);
const query = ref('');
const picked = ref(0);
const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  return DESTINATIONS.value.filter((d) => d.label.toLowerCase().includes(q));
});
const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
const jump = ref<HTMLDialogElement | null>(null);
async function openJump() {
  query.value = '';
  picked.value = 0;
  jumpOpen.value = true;
  await nextTick(); // v-dialog has noted where focus was, to return it on close
  jump.value?.showModal();
}
function onJumpKey(e: KeyboardEvent) {
  const n = matches.value.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (n) picked.value = (picked.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    void nextTick(() => document.getElementById(`adm-jump-${picked.value}`)?.scrollIntoView({ block: 'nearest' }));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const d = matches.value[picked.value];
    if (d) go(d.path);
  }
}
const go = (path: string) => (location.href = href(path));
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k' && !e.defaultPrevented) {
    e.preventDefault();
    if (!jumpOpen.value) void openJump();
  } else if (e.key === 'Escape' && mobileOpen.value) mobileOpen.value = false;
}

function onLeave(e: BeforeUnloadEvent) {
  if (props.dirty) e.preventDefault();
}
const regions = computed(() => [
  { key: 'polite', live: 'polite' as const, list: toasts.filter((t) => !t.error) },
  { key: 'assertive', live: 'assertive' as const, list: toasts.filter((t) => t.error) },
]);
function runAction(t: Toast) {
  t.action?.run();
  dismissToast(t.id);
}
/** A toast's text as plain runs and `code` runs (a command to copy, e.g. `pnpm setup:python`). */
const runs = (text: string) => text.split(/`([^`]+)`/).map((part, i) => ({ part, code: i % 2 === 1 }));
const copied = ref('');
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = text;
    setTimeout(() => copied.value === text && (copied.value = ''), 2000);
  } catch {
    // No clipboard (an insecure origin, a denied permission): the text stays selectable.
  }
}

// A bug in a screen or a promise nobody caught still ends in a toast, not a silent console line.
onErrorCaptured((e) => {
  console.error(e); // eslint-disable-line no-console
  report(e);
  return false;
});
function onUnhandled(e: PromiseRejectionEvent) {
  if ((e.reason as Error | undefined)?.name === 'AbortError') return;
  report(e.reason);
}
const onScheme = () => themeChoice.value === 'system' && applyTheme();

onMounted(async () => {
  try {
    collapsed.value = localStorage.getItem('adm-sidebar') === 'collapsed';
    themeChoice.value = (localStorage.getItem('adm-theme') as ThemeChoice | null) ?? 'system';
  } catch {
    // private mode: defaults
  }
  applyTheme();
  media.addEventListener('change', onScheme);
  addEventListener('keydown', onKey);
  addEventListener('beforeunload', onLeave);
  addEventListener('unhandledrejection', onUnhandled);
  try {
    const { capabilities, career } = await api<{ capabilities: { error?: string }; career?: { ready: number } }>('me');
    banner.value = capabilities.error ?? '';
    session.careerReady = career?.ready ?? null;
  } catch {
    // 401 reloads to the login page; other errors surface on the first save
  }
  if (props.ctx.mode === 'postgres') void loadNotices();
});
onBeforeUnmount(() => {
  media.removeEventListener('change', onScheme);
  removeEventListener('keydown', onKey);
  removeEventListener('beforeunload', onLeave);
  removeEventListener('unhandledrejection', onUnhandled);
});

async function signOut() {
  await api('auth/logout', { method: 'POST' }).catch(() => undefined);
  location.href = `${base}/login`;
}
const year = new Date().getFullYear();
</script>

<template>
  <a class="adm-skip" href="#adm-main">Skip to content</a>
  <div class="layout-wrapper" :class="{ 'layout-collapsed': collapsed, 'layout-mobile-active': mobileOpen }">
    <aside id="adm-sidebar" class="layout-sidebar" aria-label="Admin">
      <div class="layout-sidebar-header">
        <a :href="href('')" class="layout-logo">
          <span class="layout-logo-mark" aria-hidden="true">{{ ctx.siteName.slice(0, 1) || 'S' }}</span>
          <span>{{ ctx.siteName || 'ScholarOS' }}</span>
        </a>
        <button
          type="button"
          class="layout-topbar-btn layout-sidebar-close"
          aria-label="Close menu"
          @click="mobileOpen = false"
        >
          <i class="pi pi-times" aria-hidden="true" />
        </button>
      </div>
      <nav class="layout-menu" aria-label="Admin sections">
        <template v-for="group in GROUPS" :key="group.label">
          <div :id="`adm-nav-${group.label}`" class="layout-menu-heading">{{ group.label }}</div>
          <ul :aria-labelledby="`adm-nav-${group.label}`">
            <li v-for="l in group.links" :key="l.path">
              <a
                :href="href(l.path)"
                class="layout-menu-link"
                :aria-current="current === l.path ? 'page' : undefined"
                :title="collapsed ? l.label : undefined"
              >
                <i :class="['pi', l.icon]" aria-hidden="true" />
                <span class="layout-menu-text">{{ l.label }}</span>
                <span v-if="badge(l.path)" class="layout-menu-badge"
                  >{{ badge(l.path) }}<span class="adm-visually-hidden"> waiting</span></span
                >
              </a>
            </li>
            <li v-if="group.more">
              <button
                type="button"
                class="layout-menu-link"
                :aria-expanded="isMoreOpen(group)"
                :aria-controls="`adm-more-${group.label}`"
                :title="collapsed ? group.more.label : undefined"
                @click="moreOpen[group.label] = !isMoreOpen(group)"
              >
                <i :class="['pi', group.more.icon]" aria-hidden="true" />
                <span class="layout-menu-text">{{ group.more.label }}</span>
                <i class="pi pi-angle-down layout-menu-toggler" aria-hidden="true" />
              </button>
              <ul v-show="isMoreOpen(group)" :id="`adm-more-${group.label}`" class="layout-submenu">
                <li v-for="l in group.more.links" :key="l.path">
                  <a
                    :href="href(l.path)"
                    class="layout-menu-link"
                    :aria-current="current === l.path ? 'page' : undefined"
                  >
                    <span class="layout-menu-text">{{ l.label }}</span>
                  </a>
                </li>
              </ul>
            </li>
          </ul>
        </template>
      </nav>
      <div class="layout-sidebar-footer">
        <span class="layout-avatar" aria-hidden="true">{{ initials }}</span>
        <div class="layout-user">
          <strong>{{ displayName }}</strong>
          <span>{{ role }}</span>
        </div>
        <Button
          v-tooltip.top="'Sign out'"
          icon="pi pi-sign-out"
          text
          rounded
          severity="secondary"
          aria-label="Sign out"
          @click="signOut"
        />
      </div>
    </aside>

    <header class="layout-topbar">
      <button
        type="button"
        class="layout-topbar-btn"
        :aria-label="collapsed || !mobileOpen ? 'Open or collapse the menu' : 'Close the menu'"
        aria-controls="adm-sidebar"
        @click="toggleMenu"
      >
        <i class="pi pi-bars" aria-hidden="true" />
      </button>
      <button type="button" class="layout-search" aria-haspopup="dialog" @click="openJump">
        <i class="pi pi-search" aria-hidden="true" />
        <span>Jump to…</span>
        <kbd aria-hidden="true">{{ mac ? '⌘K' : 'Ctrl K' }}</kbd>
      </button>
      <div class="layout-topbar-end">
        <a
          v-tooltip.bottom="'View site'"
          class="layout-topbar-btn"
          href="/"
          target="_blank"
          rel="noopener"
          aria-label="View site"
        >
          <i class="pi pi-external-link" aria-hidden="true" />
        </a>
        <button
          type="button"
          class="layout-topbar-btn"
          :aria-label="attention ? `Notifications: ${attention} need attention` : 'Notifications'"
          aria-haspopup="dialog"
          @click="openBell"
        >
          <i class="pi pi-bell" aria-hidden="true" />
          <span v-if="attention" class="layout-topbar-dot" aria-hidden="true">{{ attention }}</span>
        </button>
        <button
          type="button"
          class="layout-topbar-btn"
          :aria-label="`Theme: ${themeChoice}`"
          aria-haspopup="menu"
          @click="(e) => themeMenu?.toggle(e)"
        >
          <i :class="['pi', themeIcon]" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="layout-topbar-btn"
          aria-label="Account"
          aria-haspopup="menu"
          @click="(e) => userMenu?.toggle(e)"
        >
          <span class="layout-avatar" aria-hidden="true">{{ initials }}</span>
        </button>
      </div>
      <Menu ref="themeMenu" :model="themeItems" popup />
      <Menu ref="userMenu" :model="userItems" popup class="adm-user-menu" />
      <Popover ref="bell" class="adm-notices">
        <div class="adm-notices-head">
          <strong>Notifications</strong>
          <a :href="href('')">Site status</a>
        </div>
        <p v-if="loadingNotices && !notices" class="adm-notices-empty">Checking…</p>
        <p v-else-if="!notices?.length" class="adm-notices-empty">
          <i class="pi pi-check-circle" aria-hidden="true" /> Everything is up to date.
        </p>
        <ul v-else>
          <li v-for="n in notices" :key="n.key">
            <span
              :class="['adm-notices-icon', n.tone === 'attention' ? 'tint-danger' : 'tint-warning']"
              aria-hidden="true"
            >
              <i :class="['pi', n.tone === 'attention' ? 'pi-exclamation-triangle' : 'pi-info-circle']" />
            </span>
            <span>
              <strong>{{ n.label }}</strong>
              <span>{{ n.detail ?? n.state }}</span>
            </span>
          </li>
        </ul>
      </Popover>
    </header>

    <div class="layout-main-container">
      <main id="adm-main" class="layout-main" :class="{ 'is-narrow': narrow }" tabindex="-1">
        <p v-if="banner || session.outage" class="adm-banner adm-banner-error" role="alert">
          {{ session.outage || banner }}
        </p>
        <div class="page-header">
          <div>
            <nav v-if="groupOf && current" class="page-crumbs" aria-label="Breadcrumb">
              <a :href="href('')">Dashboard</a>
              <i class="pi pi-angle-right" aria-hidden="true" />
              <span>{{ groupOf }}</span>
            </nav>
            <h1>{{ title }}</h1>
          </div>
          <div class="page-actions">
            <span v-if="dirty" class="chip chip-warning"
              ><i class="pi pi-circle-fill" style="font-size: 0.4rem" /> Unsaved changes</span
            >
            <slot name="actions" />
          </div>
        </div>
        <slot />
      </main>
      <footer class="layout-footer">
        © {{ year }} {{ ctx.siteName }} · Admin by
        <a href="https://github.com/yazdanimehdi/ScholarOS" target="_blank" rel="noopener">ScholarOS</a>
      </footer>
    </div>
    <div class="layout-mask" @click="mobileOpen = false" />

    <dialog
      v-if="jumpOpen"
      ref="jump"
      v-dialog
      class="adm-jump"
      aria-label="Jump to"
      @close="jumpOpen = false"
      @click.self="jumpOpen = false"
    >
      <div>
        <div class="adm-jump-field">
          <i class="pi pi-search" aria-hidden="true" />
          <input
            v-model="query"
            type="text"
            role="combobox"
            aria-label="Jump to"
            aria-expanded="true"
            aria-controls="adm-jump-list"
            aria-autocomplete="list"
            :aria-activedescendant="matches.length ? `adm-jump-${picked}` : undefined"
            placeholder="Jump to a screen or create something…"
            autocomplete="off"
            data-autofocus
            @input="picked = 0"
            @keydown="onJumpKey"
          />
          <kbd aria-hidden="true">Esc</kbd>
        </div>
        <ul id="adm-jump-list" role="listbox" aria-label="Destinations">
          <li
            v-for="(d, i) in matches"
            :id="`adm-jump-${i}`"
            :key="d.path"
            role="option"
            :aria-selected="i === picked"
            @click="go(d.path)"
            @mousemove="picked = i"
          >
            {{ d.label }}<span v-if="d.group" class="adm-muted"> {{ d.group }}</span>
          </li>
        </ul>
        <p v-if="!matches.length" class="adm-muted">Nothing matches.</p>
      </div>
    </dialog>

    <div class="adm-toasts">
      <div v-for="r in regions" :key="r.key" class="adm-toast-region" :aria-live="r.live" aria-atomic="false">
        <div v-for="t in r.list" :key="t.id" class="adm-toast" :class="{ 'adm-toast-error': t.error }">
          <i
            :class="['pi', t.error ? 'pi-exclamation-circle' : 'pi-check-circle', 'adm-toast-icon']"
            aria-hidden="true"
          />
          <span class="adm-toast-text">
            <template v-for="(r2, i) in runs(t.text)" :key="i">
              <span v-if="r2.code" class="adm-toast-code">
                <code>{{ r2.part }}</code>
                <button type="button" class="adm-toast-copy" @click="copy(r2.part)">
                  {{ copied === r2.part ? 'Copied' : 'Copy' }}
                </button>
              </span>
              <template v-else>{{ r2.part }}</template>
            </template>
            <details v-if="t.detail" class="adm-toast-detail">
              <summary>Technical details</summary>
              <pre>{{ t.detail }}</pre>
              <button type="button" class="adm-toast-copy" @click="copy(t.detail)">
                {{ copied === t.detail ? 'Copied' : 'Copy details' }}
              </button>
            </details>
          </span>
          <span class="adm-toast-actions">
            <a v-if="t.href" :href="t.href" target="_blank" rel="noopener">View commit</a>
            <Button v-if="t.action" size="small" :label="t.action.label" @click="runAction(t)" />
            <button type="button" class="adm-toast-close" @click="dismissToast(t.id)">Dismiss</button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
