#!/usr/bin/env tsx
/**
 * Runs before `astro build` on Vercel (package.json `vercel-build`). In Postgres mode it sets up the database
 * (src/lib/db-bootstrap.ts); otherwise it does nothing. This is what makes the Deploy button a one-click setup.
 */
import path from 'node:path';
import { put } from '@vercel/blob';
import postgres from 'postgres';
import type { Sql } from '../src/lib/db';
import { bootstrap } from '../src/lib/db-bootstrap';
import { setupProblems } from '../src/lib/deploy-check';

// Say what the deployment still lacks (the Deploy button can leave Neon out silently), with the fix, at the top of
// the build log. The login screen shows the same list.
const problems = setupProblems(process.env);
if (problems.length) {
  console.log(
    `\nScholarOS setup is not finished:\n${problems.map((p) => `  ${p.level.toUpperCase()}: ${p.text}`).join('\n')}\n`,
  );
}
if (!process.env.VERCEL || !process.env.DATABASE_URL) process.exit(0);
// Copying the content uploads its images to Blob: without a store that fails halfway, so stop here with the fix.
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Postgres mode setup stopped: no Blob store is connected (see above).');
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const sql = client as unknown as Sql;
try {
  // One connection, so this session lock keeps two simultaneous builds from setting up the same database.
  await client`select pg_advisory_lock(hashtext('scholaros-bootstrap'))`;
  const done = await bootstrap(
    sql,
    path.resolve(import.meta.dirname, '..'),
    process.env,
    async (filename, bytes, contentType) =>
      (await put(filename, bytes, { access: 'public', contentType, addRandomSuffix: false, allowOverwrite: true })).url,
  );
  console.log(done.length ? `Postgres mode:\n  ${done.join('\n  ')}` : 'Postgres mode: database up to date');
} catch (e) {
  console.error(`Postgres mode setup failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
