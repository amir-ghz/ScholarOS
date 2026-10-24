/**
 * What a Vercel deployment still lacks, in plain words with the fix. The one-click Deploy button can leave a piece out
 * (the Neon store can be skipped silently, a secret can be too short), and without this the site shows only a
 * cryptic build failure or an admin nobody can sign in to. The build log prints these, and so does the login screen.
 */
export interface SetupProblem {
  /** 'error': part of the site can't work until it's fixed; 'warning': something runs without it, but not all. */
  level: 'error' | 'warning';
  text: string;
}

const REDEPLOY = 'then redeploy (Deployments → the latest → ⋯ → Redeploy)';

/** Problems of a deployed site (VERCEL_ENV production or preview); none for `pnpm dev` or a static build. */
export function setupProblems(env: Record<string, string | undefined>): SetupProblem[] {
  if (!['production', 'preview'].includes(env.VERCEL_ENV ?? '')) return [];
  const problems: SetupProblem[] = [];
  const postgres = !!env.DATABASE_URL;
  const github = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
  if (!postgres && !github) {
    problems.push({
      level: 'error',
      text:
        'No database is connected, so nobody can sign in to the admin. In your Vercel project open Storage and ' +
        `connect a Neon (Postgres) database to all environments (if one is already listed, it was added after this build), ${REDEPLOY}.`,
    });
  }
  if (postgres && !env.BLOB_READ_WRITE_TOKEN) {
    problems.push({
      level: 'error',
      text: `No Blob store is connected, so images and the CV PDF have nowhere to go. In your Vercel project open Storage and connect a Blob store with public access, ${REDEPLOY}.`,
    });
  }
  if ((env.SESSION_SECRET ?? '').length < 32) {
    problems.push({
      level: 'error',
      text: `SESSION_SECRET is missing or shorter than 32 characters, so the admin refuses every sign-in. Set it under Settings → Environment Variables to any random text of 32+ characters (\`openssl rand -base64 48\`), ${REDEPLOY}.`,
    });
  }
  if (postgres && !env.CRON_SECRET) {
    problems.push({
      level: 'warning',
      text: `CRON_SECRET is not set, so the nightly jobs (scheduled posts, feeds, the backup) never run. Set it under Settings → Environment Variables to any random text of 32+ characters, ${REDEPLOY}.`,
    });
  }
  return problems;
}
