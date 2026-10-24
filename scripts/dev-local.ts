#!/usr/bin/env tsx
/**
 * pnpm dev — `astro dev` in Postgres mode on a local PGlite database in .data/db, uploads in public/uploads: every
 * feature, no Neon, Vercel or Blob account. The first run copies the repo's content in and asks for the owner account.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { normalizeUsername } from '../src/lib/admin/accounts';
import { assertPasswordPolicy } from '../src/lib/admin/passwords';
import { loadAdminSettings } from '../src/lib/admin/settings';
import { connect, localDatabaseUrl } from '../src/lib/db';
import { postgresDevEnv } from '../src/lib/dev-env';
import { LOCAL_DATABASE, ensureSessionSecret, setUpLocal, type OwnerAccount } from '../src/lib/local-dev';
import { ask } from './ask';

const ROOT = path.resolve(import.meta.dirname, '..');
const file = path.join(ROOT, '.env.local');
if (!process.env.SESSION_SECRET) ensureSessionSecret(file);
const fileEnv = parseEnv(fs.readFileSync(file, 'utf8'));
const url = localDatabaseUrl(path.join(ROOT, LOCAL_DATABASE));

async function askOwner(): Promise<OwnerAccount> {
  const login = `/${loadAdminSettings(ROOT).adminPath}/login`;
  console.log(`No admin account yet. Create the site owner: it signs in at ${login} and sees every feature.`);
  for (;;) {
    const username = (await ask('Username: ')).trim().toLowerCase();
    const password = await ask('Password (12+ characters): ', true);
    try {
      normalizeUsername(username);
      assertPasswordPolicy(password);
    } catch (e) {
      console.error((e as Error).message);
      continue;
    }
    if ((await ask('Password again: ', true)) === password) return { username, password };
    console.error('The passwords don’t match.');
  }
}

console.log(`Local database: ${LOCAL_DATABASE}`);
const sql = connect(url);
const { done, owner } = await setUpLocal(sql, ROOT, process.stdin.isTTY ? askOwner : null)
  // One process at a time: astro dev opens the folder again on its first query.
  .finally(() => sql.end())
  .catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
for (const line of done) console.log(line);
const env = { ...postgresDevEnv(fileEnv, process.env, url), ...(owner ? { SCHOLAROS_OWNER: owner } : {}) };
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules/astro/bin/astro.mjs'), 'dev', ...process.argv.slice(2)],
  { cwd: ROOT, env, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
