# Known issues

Problems found while setting up and running ScholarOS (this fork, branch `local-dev-setup`), what caused them and
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

4. **The GitHub Pages deploy fails on every push and daily.** `.github/workflows/deploy.yml`: "Get Pages site
   failed… Not Found". Pages isn't enabled, and on a free plan it doesn't serve private repos. Other scheduled workflows
   (`sync-scholar`, `sync-feeds`, `release-scheduled` daily; `sync-template` weekly) run on this repo too.
   `template-init` already committed to `main` ("chore: initialize template for amir-ghz"). _Decide:_ keep, configure
   or disable each.
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

| Problem                                                                                                                                     | Cause                                                                                                                                                                                                                                         | Commit                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm install` skipped esbuild's and ffmpeg-static's install scripts                                                                        | pnpm 11 ignores `pnpm.onlyBuiltDependencies` in package.json                                                                                                                                                                                  | `08986aa`                                                              |
| CV PDF: "CV renderer failed (exit 1): … No module named 'yaml'"                                                                             | System `python3` (3.9) without RenderCV's packages; RenderCV needs 3.10+                                                                                                                                                                      | `91e69e6` (`pnpm setup:python`, project `.venv`, plain-English errors) |
| Admin errors showed raw tracebacks; a crash in a screen failed silently                                                                     | Toasts printed the server's text as-is; no global error handling                                                                                                                                                                              | `b1c68f2`                                                              |
| No way to create the first account from the browser                                                                                         | `pnpm dev` asked only in a terminal                                                                                                                                                                                                           | `afa222b` (first-run sign-up, local database only)                     |
| `eslint .` reported 950+ errors                                                                                                             | It linted JavaScript inside `.venv`                                                                                                                                                                                                           | `a0ffc57`                                                              |
| Adding a paper by DOI: summary stuck "running"; "Content read outside a request in Postgres mode" from `404.astro`; at times every page 500 | `astro.config.mjs` deleted the Workflow SDK's generated routes on every config load, so `astro check`/`astro sync` removed them under a running `pnpm dev`; a POST to a missing public route rendered `404.astro` outside the request context | `9bb636a`                                                              |
