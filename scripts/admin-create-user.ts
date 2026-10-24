#!/usr/bin/env tsx
/**
 * pnpm admin:create-user <username> [--reset] [--production]
 * Creates a password account (or with --reset sets a new password) on the dev branch (DEV_DATABASE_URL), on
 * `pnpm dev`'s local database (.data/db) when there is no dev branch, or with --production on DATABASE_URL after you
 * type the username again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createAccount, resetPassword } from '../src/lib/admin/accounts';
import { assertPasswordPolicy } from '../src/lib/admin/passwords';
import { migrate } from '../src/lib/db-migrate';
import { connect, localDatabaseUrl } from '../src/lib/db';
import { confirmsProduction, databaseFor, hostOf } from '../src/lib/dev-env';
import { LOCAL_DATABASE } from '../src/lib/local-dev';
import { ask } from './ask';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--'));
const production = args.includes('--production');
const resetting = args.includes('--reset');
if (!username) {
  console.error('Usage: pnpm admin:create-user <username> [--reset] [--production]');
  process.exit(1);
}
const file = path.join(ROOT, '.env.local');
const env = { ...(fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {}), ...process.env };

const local = !production && !env.DEV_DATABASE_URL;
let url: string;
try {
  url = local ? localDatabaseUrl(path.join(ROOT, LOCAL_DATABASE)) : databaseFor(env, production);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
console.log(
  local ? `Local database: ${LOCAL_DATABASE}` : `${production ? 'PRODUCTION' : 'Dev branch'} database: ${hostOf(url)}`,
);
if (production && !confirmsProduction(await ask(`Type the username (${username}) to confirm: `), username)) {
  console.error('Not confirmed; nothing written.');
  process.exit(1);
}
const name = resetting ? '' : await ask('Display name: ');
const password = await ask('Password (12+ characters): ', true);
try {
  assertPasswordPolicy(password);
} catch (e) {
  console.error(`${(e as Error).message}; nothing written.`);
  process.exit(1);
}
if ((await ask('Password again: ', true)) !== password) {
  console.error('The passwords don’t match; nothing written.');
  process.exit(1);
}
const sql = connect(url);
try {
  await migrate(sql, path.join(ROOT, 'migrations'));
  if (resetting) {
    await resetPassword(sql, username, password);
    console.log(`New password set for ${username}; their sessions have ended.`);
  } else {
    const account = await createAccount(sql, username, name, password);
    console.log(`Created ${account.username}. Sign in at /<adminPath>/login.`);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
