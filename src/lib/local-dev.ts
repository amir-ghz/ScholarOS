import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import yaml from 'js-yaml';
import { createAccount } from './admin/accounts';
import type { Sql } from './db';
import { seedContent } from './db-bootstrap';
import { migrate } from './db-migrate';
import { localUploads } from './local-uploads';

/** Where `pnpm dev` keeps its database, relative to the repo. */
export const LOCAL_DATABASE = '.data/db';

export interface OwnerAccount {
  username: string;
  password: string;
}

/**
 * `pnpm dev`'s setup of the local database, safe on every start: new migrations, the repo's content while
 * `documents` is empty, an account from `ask` while there is none, and the oldest account as the job-search owner
 * while the database's site.yml names none. Returns what it did and the owner entry ('' for none).
 */
export async function setUpLocal(
  sql: Sql,
  root: string,
  ask: (() => Promise<OwnerAccount>) | null,
): Promise<{ done: string[]; owner: string }> {
  const done: string[] = [];
  const applied = await migrate(sql, path.join(root, 'migrations'));
  if (applied.length) done.push(`migrations applied: ${applied.join(', ')}`);

  const [{ count: docs }] = await sql<{ count: number }>`select count(*)::int as count from documents`;
  if (docs === 0) {
    const uploads = localUploads(root);
    const seeded = await seedContent(sql, root, async (filename, bytes) => (await uploads.put(filename, bytes)).url);
    done.push(`content copied: ${seeded.documents} documents, ${seeded.images} images`);
  }

  const [{ count: accounts }] = await sql<{ count: number }>`select count(*)::int as count from admin_users`;
  if (accounts === 0 && ask) {
    const { username, password } = await ask();
    done.push(`admin account created: ${(await createAccount(sql, username, '', password)).username}`);
  } else if (accounts === 0) {
    done.push(
      'no admin account: stop the server (Ctrl-C), run `pnpm admin:create-user <username>`, then `pnpm dev` again',
    );
  }
  return { done, owner: await ensureOwner(sql, done) };
}

const SITE = 'config/site.yml';

/** site.yml's `owner`, or else the oldest account, written into site.yml as `password:<username>`. */
async function ensureOwner(sql: Sql, done: string[]): Promise<string> {
  const [site] = await sql<{ content: string }>`select content from documents where path = ${SITE}`;
  if (!site) return '';
  const named = (yaml.load(site.content) as { owner?: unknown } | null)?.owner;
  if (named) return String(named);
  const [first] = await sql<{ username: string }>`
    select username from admin_users order by created_at, username limit 1`;
  if (!first) return '';
  const owner = `password:${first.username}`;
  const line = `owner: '${owner}'`;
  // The key's line, else the template's commented-out `# owner:` line, else a new last line.
  const at = /^owner:.*$/m.test(site.content) ? /^owner:.*$/m : /^#\s*owner:.*$/m;
  const content = at.test(site.content) ? site.content.replace(at, line) : `${site.content.trimEnd()}\n${line}\n`;
  await sql.begin(async (tx) => {
    const [row] = await tx<{ version: number }>`
      update documents set content = ${content}, version = version + 1, updated_at = now(), updated_by = 'pnpm dev'
      where path = ${SITE} returning version`;
    await tx`insert into revisions (path, content, version, author) values (${SITE}, ${content}, ${row.version}, 'pnpm dev')`;
  });
  done.push(`job-search owner: ${owner}`);
  return owner;
}

/**
 * The SESSION_SECRET in `file` (.env.local), first written there when it has none: the admin encrypts saved AI keys
 * with it, so a new one each start would lose them.
 */
export function ensureSessionSecret(file: string, generate = () => randomBytes(32).toString('base64url')): string {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const have = parseEnv(text).SESSION_SECRET;
  if (have) return have;
  const secret = generate();
  const line = `SESSION_SECRET=${secret}`;
  // An empty `SESSION_SECRET=` (copied from .env.example) is filled in, not shadowed by a second line.
  const next = /^SESSION_SECRET=.*$/m.test(text)
    ? text.replace(/^SESSION_SECRET=.*$/m, line)
    : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
  fs.writeFileSync(file, next, { mode: 0o600 });
  return secret;
}
