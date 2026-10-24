import test from 'node:test';
import assert from 'node:assert/strict';
import { setupProblems } from './deploy-check';

const SECRET = 'x'.repeat(32);
const complete = {
  VERCEL: '1',
  VERCEL_ENV: 'production',
  DATABASE_URL: 'postgres://db',
  BLOB_READ_WRITE_TOKEN: 'blob',
  SESSION_SECRET: SECRET,
  CRON_SECRET: SECRET,
};
const levels = (env: Record<string, string | undefined>) =>
  setupProblems(env).map((p) => `${p.level}: ${p.text.split(',')[0]}`);

test('a complete deployment, `pnpm dev` and a static build have nothing to report', () => {
  assert.deepEqual(setupProblems(complete), []);
  assert.deepEqual(setupProblems({ VERCEL: '1', DATABASE_URL: 'pglite:.data/db' }), []);
  assert.deepEqual(setupProblems({}), []);
});

test('the Deploy button skipped Neon: no database and no GitHub sign-in', () => {
  const { DATABASE_URL: _, ...noDb } = complete;
  assert.deepEqual(levels(noDb), ['error: No database is connected']);
  // Git mode set up on purpose (GitHub OAuth) is not a problem.
  assert.deepEqual(setupProblems({ ...noDb, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's' }), []);
});

test('missing Blob, a short SESSION_SECRET and no CRON_SECRET each say how to fix them', () => {
  const env = { ...complete, BLOB_READ_WRITE_TOKEN: '', SESSION_SECRET: 'short', CRON_SECRET: undefined };
  const problems = setupProblems(env);
  assert.deepEqual(
    problems.map((p) => p.level),
    ['error', 'error', 'warning'],
  );
  for (const p of problems) assert.match(p.text, /redeploy/);
  assert.match(problems[0].text, /Blob/);
  assert.match(problems[1].text, /SESSION_SECRET/);
  assert.match(problems[2].text, /CRON_SECRET/);
});
