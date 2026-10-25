# Admin redesign on the Conca "Academy" look, with site analytics

**Goal.** Replace the admin's UI/UX with the design language of the Conca Bootstrap 5 dashboard
(<https://html.aqlova.com/conca-demo/conca/dashboard-academy.html>), connect every existing admin feature to it, and
add first-party site analytics (visitors, page views, where they came from, countries, devices) shown the way Conca's
Academy and Analytics dashboards show data.

**Status.** Done 2026-10-25 on branch `admin-redesign` (D1 and D2 taken with the owner).

All admin screens moved: the shell, login, Dashboard and the new Analytics screen, plus content (12 files), setup
(8), job search (4) and reading (10). Each was checked in Chrome at 1440px light and dark and at 390px, and the
checks below passed.

| Check | Result |
| --- | --- |
| Unit tests (`pnpm test`) | 1,341 of 1,366 pass; 25 skipped by the suite. One timing test failed once under load and passes alone and on `main`. |
| Browser tests (`tests/e2e/admin.spec.ts`, run with installed Chrome) | 18/18 pass |
| Read-only sweep of 27 routes × light, dark and phone | 81 views: status 200, no console errors, no sideways scroll |
| `astro check` | 0 errors, 0 warnings |
| Static build | 37 pages; no PrimeVue CSS or JS on public pages |

---

## Decisions

### D1. How the Conca design gets in: Sakai, made to look like Conca

Conca is a ThemeForest item. Its Regular License allows one end product for the buyer (clause 2) but not
redistribution "in a tool or template, or with source files" (clause 8). ScholarOS is a template others deploy, so
Conca's files can't be in it. Conca is therefore the **visual reference only**. The implementation starts from
**Sakai** (PrimeTek, MIT; <https://github.com/primefaces/sakai-vue>): its Vue 3 layout, PrimeVue setup and widgets,
restyled with Conca's proportions and palette (indigo `#5F4AFE`, canvas `#F4F4F7`, 275px sidebar, 60px header,
12px cards with a soft shadow, label chips).

### D2. Libraries (and the licence traps avoided)

| Package | Version | Licence | Note |
| --- | --- | --- | --- |
| primevue | **4.5.5 (exact)** | MIT | |
| @primeuix/themes | **2.0.3 (exact)** | MIT | 3.x is "PrimeUI License" (commercial above $1M revenue / 5 devs) |
| primeicons | **7.0.0 (exact)** | MIT | 8.x is under the same commercial licence |
| tailwindcss-primeui | 0.6.x | MIT | |
| chart.js | 4.x | MIT | ApexCharts avoided: 5.x+ needs a paid licence at or above $2M |
| jsvectormap | 1.7.0 | MIT | world map |

A test (`src/admin/licenses.test.ts`) fails if any installed PrimeTek package stops being MIT.

PrimeVue is installed per island by `src/pages/_app.ts` only when `<body data-admin>` (a dynamic import), so public
pages never download it. The admin stylesheet (`src/admin/prime/admin.css`) is Tailwind scoped to `src/admin` plus
the PrimeUI plugin, PrimeIcons and our layout (`src/admin/prime/layout.css`). The old `admin.css` tokens point at
the new ones, so screens not yet rebuilt still match the palette, dark mode included.

### D3. Analytics model

First-party and cookieless, stored in the site's own Postgres (Neon on Vercel, PGlite under `pnpm dev`). No
third-party script, so no consent banner is needed for it.

- **Collect.** A ~1 kB script on public pages sends `navigator.sendBeacon('/api/collect', …)`: path, referrer,
  screen width, language, UTM tags. Pages are CDN-cached, so counting in middleware would miss cache hits.
- **Server side.** Country, region and city come from Vercel's `x-vercel-ip-*` headers; browser, OS and device from
  the User-Agent; bots are dropped. A visitor is a hash of (daily salt, IP, User-Agent). The salt rotates every day and
  the IP is never stored, so visitors can't be followed across days. `DNT: 1` and `Sec-GPC: 1` are honoured. Each IP
  is rate-limited.
- **Store.** Migration `012_analytics.sql` adds `page_views` (time, path, visitor hash, referrer host, channel, UTM
  source, country, region, city, device, browser, OS, language). Retention is configurable (default 13 months).
- **Read.** `GET /api/admin/analytics?range=7d|30d|90d|12m`, compared with the previous period: totals, time series,
  top pages, channels, referrers, countries, regions, cities, devices, browsers, OS, live (last 5 minutes).
- **Modes.** Postgres mode and `pnpm dev` only. Git and static sites can keep the existing GA, Plausible and other
  options in `config/site.yml`.

## Screen mapping

| Ours | Conca reference | Notes |
| --- | --- | --- |
| Shell (sidebar, header) | Sidebar groups with icons and badges, header with search, notifications and avatar | Keep groups: Content, Career, Reading, Site, Setup. ⌘K search goes in the header. Notifications = site-status problems. Light/dark toggle. Off-canvas sidebar on phones. |
| Login, first-run sign-up, setup problems | `auth-login-cover` | Two-panel card (site name and tagline on the colour panel). Keep the setup checklist and the local first-run sign-up. |
| Dashboard | `dashboard-academy` | 4 stat cards (Visitors, Page views, Publications, Posts, each with a vs-previous-period chip). "Revenue Overview" becomes Visitors and page views over time. "Category Enrollment" donut becomes views by section (Publications, Blog, CV, People…). "Top Instructors" becomes Top pages. "Popular Courses" becomes Most-read publications and posts. "Latest Reviews" becomes Recent activity (revisions). "Latest Courses" table becomes Content with Published/Draft/Scheduled badges and row actions. Site status (Retry, Run daily jobs) moves into a card. |
| Analytics (new) | `dashboard-analytics`, `map-vector` | World map with country shading, "Sales by Region" becomes Visitors by country (progress bars, change chips), Traffic sources polar chart, channels table, browser and device tables, live visitors, range picker. |
| Blog posts, News, Publications, People, Projects, Talks, Positions | `lms-course-list`, `users-list` | Searchable, sortable, paginated tables (Vue), status badges, bulk-select, row action menus. |
| Post editor, entry forms | `form-layout`, `form-editors` | Cards with section headers, Bootstrap form controls, sticky action bar; TipTap editor in a card. |
| CV, CV styles | `form-layout`, `lms-course-details` | Three-column editor in cards; styles as a card grid with previews. |
| Media | `lms-course-grid` | Card grid, upload drop zone. |
| Settings, Integrations, Reading/Job settings | `user-settings` | Left nav tabs plus form cards (AdminSections). |
| Users | `users-list`, `users-add` | Table plus add form in an off-canvas panel. |
| Pages, Site editor | `form-editors`, `app-chat` | The editor's agent log in the chat layout. |
| Job search (4 screens) | `ecommerce-order-list`, `ecommerce-order-details` | Pipeline table, detail page with timeline. |
| Reading (7 screens) | `lms-course-*`, `app-chat`, `extended-ui-timeline` | Library grid or list, reading room with chat panel, vault list and graph. |
| Toasts, confirms, banners | `ui-toast`, `extended-ui-sweetalert2`, `ui-alerts` | Keep today's behaviour (actions, Technical details, Copy); restyle. |

## Phases (one or more commits each, pushed to `local-dev-setup`)

1. **Foundation.** Dependencies; SCSS tokens (Conca palette, Inter, radii, shadows, light and dark); admin-only
   bundle; Vue UI kit (`src/admin/ui/`: PageHeader, Card, StatCard, ChartCard, DataTable, Badge, Avatar, Dropdown,
   Modal/Confirm, Tabs, Field wrappers, EmptyState, Skeleton). New AdminShell and Login. Old `admin.css` stays until
   the last screen moves.
2. **Analytics backend.** Migration, `/api/collect`, UA and channel parsing, salt rotation, aggregation queries,
   retention job (in the daily cron), `/api/admin/analytics`, the collect script in the public layout (Postgres
   mode), privacy settings. Unit tests on PGlite.
3. **Dashboard and Analytics screens.**
4. **Content:** Posts, PostEditor, Collection with FormFields, Media, Pages.
5. **Site and setup:** CV, CvStyles, Settings, Integrations, Users, Site editor.
6. **Career and Reading** (11 screens).
7. **Finish.** Remove `admin.css`; dark mode and phone pass; accessibility pass; DESIGN.md admin section rewritten;
   README screenshots and analytics/privacy docs; KNOWN-ISSUES updated.

## Testing (every phase, and in full at the end)

- **Unit:** the existing 1,355 tests stay green. New tests for collect (bots, DNT/GPC, rate limit, geo headers,
  hashing), UA and channel parsing, aggregation, ranges and deltas, retention.
- **End to end (Playwright):** update the existing admin specs to the new markup. New specs:
  - visit public pages, then see them counted on Analytics
  - sign in through the new login
  - each content type: create, edit, publish, delete
  - toasts and confirm dialogs
- **Visual sweep:** every admin route at 1440px and 390px, light and dark, captured and reviewed against the Conca
  screenshots.
- **Accessibility:** axe-core (`@axe-core/playwright`, MPL-2.0, dev only) on every route, plus keyboard-only runs of
  the shell, tables, dialogs and editor.
- **Builds:** `astro check`, lint, a static build (public site byte-for-byte unaffected apart from the collect
  script), and a Postgres-mode build. Public page weight before and after.

## Risks

- **Size.** About 10k lines of Vue and 1,000 styling hooks; several sessions of work.
- **Upstream fit.** DESIGN.md currently calls the admin "deliberately neutral", sharing the journal's tokens. Mehdi
  may not want a Bootstrap admin. Mitigation: present it as a separate PR, and keep the analytics work separate from
  the restyle so either can be taken alone.
- **Analytics accuracy.** Ad blockers block some beacons; numbers are a lower bound. This is documented on the
  Analytics screen.
