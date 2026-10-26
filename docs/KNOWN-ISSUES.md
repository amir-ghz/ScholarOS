# Known issues

Problems found while setting up and running ScholarOS (fork `amir-ghz/ScholarOS`, branch `local-dev-setup`), what caused them and
where they stand. Newest findings go at the end of each section. When one is fixed, move it to **Fixed** with the
commit.

## Open

### Content and data

1. **Local edits can't leave your machine.** `pnpm dev` keeps all content in `.data/` (gitignored). `pnpm db:export`
   opens `DATABASE_URL` with the Postgres client ([scripts/db-export.ts](../scripts/db-export.ts)), which can't read
   the local PGlite database, and the daily git backup is off in dev on purpose
   ([src/lib/dev-env.ts](../src/lib/dev-env.ts)). Deleting `.data/` loses everything; nothing done locally reaches a
   deployed site. _Needs:_ an export (documents and `.data/uploads`) that reads the local database, and a way to copy
   it into production.
2. **The site is still the template's sample content.** "Prof. Jane Smith", 5 sample publications, people, news. Two
   leaks of real people: the CV lists a real paper by another author, and the Repositories page shows a stranger's
   GitHub stats because `github.username` is `example-lab` (`config/site.yml`). _Needs:_ a first-run "make it yours"
   step and a dashboard warning while placeholders remain.
3. **The site's address is `https://example.com`.** `siteUrl` in `config/site.yml` and `site` in `astro.config.mjs`.
   Canonical links, the sitemap, RSS and share previews point there until it is set (in Postgres mode: admin →
   Settings).

### Repository and deployment

4. **Scheduled git-mode workflows run on every copy the Vercel button makes.** `sync-scholar`, `sync-feeds`,
   `release-scheduled` (daily) and `sync-template` (weekly) commit to git, which has no effect on a Postgres-mode
   (Vercel) site. _Needs:_ the same "skip with a notice" the Pages deploy got, or a switch in `config/site.yml`.
   The Vercel button still needs one test on a fresh Hobby account: whether the Neon `stores` entry creates the
   database (if it doesn't, the login page and build log now say so and how to fix it).
5. **CV PDFs on Vercel depend on a second (Python) service** declared under `services` in `vercel.json`. Untested for
   this account; without it the admin says "CV renderer not configured" or "unreachable".

### Accounts and security

6. **No password recovery.** A forgotten password needs another admin or `pnpm admin:create-user <name> --reset`
   against the production database. Email (Resend) exists only for digests.
7. **No invites or roles.** The owner sets a password for each new account and shares it out of band; no forced
   change at first sign-in. Every account can edit everything (only Site-editor publishing is restricted), so a lab
   member can't be limited to their own profile.
8. **No two-step sign-in.**

### Reliability

9. **No alerting.** Server errors go to `console.error` only; a failed nightly job shows only on the dashboard. No
   error tracking, no failure email, no health-check URL.
10. **Nightly jobs never run locally.** Use **Run daily jobs** on the dashboard.
11. **Features are silently off without keys.** Contact/newsletter/application forms (`web3forms.accessKey`), Scholar
    import (`SERPAPI_KEY`), AI features (Anthropic/OpenAI/Gemini key), digests (`RESEND_API_KEY`), Site editor
    (Vercel OIDC + `GITHUB_TOKEN` + AI key), analytics. _Needs:_ one checklist of what's configured.
12. **Three timing tests fail when the machine is busy** (`sniffImage handles ReDoS…`, `hostile DOCTYPE-heavy SVGs…`
    in `src/lib/admin/media.test.ts`, `parseDraft stays fast…` in `src/lib/reading/blog-prompts.test.ts`). They pass
    alone.

13. **Playwright's bundled Chromium isn't installed on this machine.** `pnpm test:e2e` fails at launch. Run
    `npx playwright install chromium` once, or run the suite with the installed Chrome (`channel: 'chrome'`).
14. **The job-search tab style is defined three times.** Career, CareerJob and CareerSettings each restyle
    AdminTabLinks with the same scoped block; it could live in the component.

### Design (from a Chrome walkthrough)

13. Fonts load from Google with `display=optional`: first visits often render fallback fonts
    (`src/components/astro/FontStyles.astro`).
14. Post editor title renders as a 14px bordered input: `.adm input[type='text']` outranks `.adm .adm-title-input`
    (`src/admin/admin.css`).
15. Header nav changes from page to page (six-link cap swaps in the current page); `/talks` is linked from nowhere.
16. Positions whose deadline passed still show as open (`src/themes/editorial/Positions.astro`).
17. CV: ISO dates (`2010-09 – 2015-05`) unlike the rest of the site; section heads in Accent though DESIGN.md says
    Ink.
18. Admin: content capped at 880px while header actions sit at 1080px; toasts can cover row actions.

## Fixed

| Problem                                                                                                                                                                        | Cause                                                                                                                                                                                                                                         | Commit                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install` skipped esbuild's and ffmpeg-static's install scripts                                                                                                           | pnpm 11 ignores `pnpm.onlyBuiltDependencies` in package.json                                                                                                                                                                                  | `08986aa`                                                                                                                                                   |
| CV PDF: "CV renderer failed (exit 1): … No module named 'yaml'"                                                                                                                | System `python3` (3.9) without RenderCV's packages; RenderCV needs 3.10+                                                                                                                                                                      | `91e69e6` (`pnpm setup:python`, project `.venv`, plain-English errors)                                                                                      |
| Admin errors showed raw tracebacks; a crash in a screen failed silently                                                                                                        | Toasts printed the server's text as-is; no global error handling                                                                                                                                                                              | `b1c68f2`                                                                                                                                                   |
| No way to create the first account from the browser                                                                                                                            | `pnpm dev` asked only in a terminal                                                                                                                                                                                                           | `afa222b` (first-run sign-up, local database only)                                                                                                          |
| `eslint .` reported 950+ errors                                                                                                                                                | It linted JavaScript inside `.venv`                                                                                                                                                                                                           | `a0ffc57`                                                                                                                                                   |
| Adding a paper by DOI: summary stuck "running"; "Content read outside a request in Postgres mode" from `404.astro`; at times every page 500                                    | `astro.config.mjs` deleted the Workflow SDK's generated routes on every config load, so `astro check`/`astro sync` removed them under a running `pnpm dev`; a POST to a missing public route rendered `404.astro` outside the request context | `9bb636a`                                                                                                                                                   |
| One-click Vercel copies: the GitHub Pages deploy failed on every push and every morning, emailing the owner; the button's "Create a Team"/Pro trial read as if Pro were needed | Those repositories have no GitHub Pages; the README didn't say ScholarOS runs on Hobby                                                                                                                                                        | `b28f2a9` (Pages deploy skips with a notice when Pages is off; README: sign up for Hobby first)                                                             |
| Vercel button: **Create** did nothing                                                                                                                                          | It proposed the repository name `scholaros`, which (GitHub names ignore case) clashes with a ScholarOS fork                                                                                                                                   | `78f6f09` (default `scholaros-site`; README says what to do if a name is taken)                                                                             |
| Vercel button: a deploy missing Neon, Blob or a long-enough secret failed cryptically or gave an admin nobody could sign in to                                                 | Nothing checked what the deployment had                                                                                                                                                                                                       | `003a789` (setup checklist with the fix, in the build log and on the login page)                                                                            |
| Admin looked dated; no visitor analytics                                                                                                                                       | —                                                                                                                                                                                                                                             | `admin-redesign` branch: Sakai/PrimeVue admin with the Conca look, first-party analytics (see the plan in docs/superpowers/plans/2026-10-25-conca-admin.md) |
