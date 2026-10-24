import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { signIn } from './admin/accounts';
import { ensureSessionSecret, setUpLocal } from './local-dev';
import { pgliteSql } from './pglite-sql';

/** A copy of the repo's content, so the seeded images land in a temp .data/uploads. */
function repoCopy(): string {
  const repo = path.resolve(import.meta.dirname, '../..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholaros-local-'));
  for (const dir of ['config', 'migrations', 'src/content', 'src/assets/images', 'public/images']) {
    if (fs.existsSync(path.join(repo, dir))) fs.cpSync(path.join(repo, dir), path.join(root, dir), { recursive: true });
  }
  return root;
}

const jane = { username: 'jane', password: 'a long enough password' };

test('setUpLocal: an empty database gets tables, the content, the asked-for account as owner; a rerun does nothing', async () => {
  const root = repoCopy();
  const sql = pgliteSql();
  let asked = 0;
  const ask = async () => (asked++, jane);

  const first = await setUpLocal(sql, root, ask);
  assert.equal(asked, 1);
  assert.equal(first.owner, 'password:jane');
  assert.ok(first.done.some((l) => l.startsWith('migrations applied')));
  assert.ok(first.done.some((l) => l.startsWith('content copied')));
  assert.equal((await signIn(sql, 'jane', jane.password, new Date(), '')).ok, true);
  const [site] = await sql<{ content: string }>`select content from documents where path = 'config/site.yml'`;
  assert.equal((yaml.load(site.content) as { owner: string }).owner, 'password:jane', 'the owner is in the database');
  assert.equal(fs.readFileSync(path.join(root, 'config/site.yml'), 'utf8').includes("owner: 'password:jane'"), false);
  const [media] = await sql<{ url: string }>`select url from media order by url limit 1`;
  assert.match(media.url, /^\/uploads\//);
  assert.ok(fs.existsSync(path.join(root, '.data', decodeURIComponent(media.url))), 'seeded images are on disk');

  await sql`update documents set content = content || '# edited' where path = 'config/site.yml'`;
  const second = await setUpLocal(sql, root, ask);
  assert.deepEqual(second, { done: [], owner: 'password:jane' });
  assert.equal(asked, 1, 'no prompt once an account exists');
  const [again] = await sql<{ content: string }>`select content from documents where path = 'config/site.yml'`;
  assert.ok(again.content.endsWith('# edited'), 'existing content is never reseeded');
  const [{ count }] = await sql<{ count: number }>`select count(*)::int as count from admin_users`;
  assert.equal(count, 1);
});

test('setUpLocal: without a prompt it says how to create the owner, and the next start makes that account owner', async () => {
  const root = repoCopy();
  const sql = pgliteSql();
  const first = await setUpLocal(sql, root, null);
  assert.equal(first.owner, '');
  assert.ok(first.done.some((l) => l.includes('pnpm admin:create-user <username>')));

  await sql`insert into admin_users (username, name, password_hash) values ('bob', 'bob', 'x')`;
  assert.deepEqual(await setUpLocal(sql, root, null), {
    done: ['job-search owner: password:bob'],
    owner: 'password:bob',
  });
});

test('setUpLocal: an owner site.yml already names is kept', async () => {
  const root = repoCopy();
  const sql = pgliteSql();
  await setUpLocal(sql, root, async () => jane);
  await sql`update documents set content = replace(content, 'password:jane', 'someone') where path = 'config/site.yml'`;
  assert.equal((await setUpLocal(sql, root, null)).owner, 'someone');
});

test('ensureSessionSecret: written once into .env.local, filling an empty line, and kept after', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholaros-env-'));
  const file = path.join(dir, '.env.local');
  fs.writeFileSync(file, 'GITHUB_REPO=a/b\nSESSION_SECRET=\n');
  let made = 0;
  const generate = () => `secret-${++made}`;
  assert.equal(ensureSessionSecret(file, generate), 'secret-1');
  assert.equal(ensureSessionSecret(file, generate), 'secret-1');
  assert.equal(fs.readFileSync(file, 'utf8'), 'GITHUB_REPO=a/b\nSESSION_SECRET=secret-1\n');

  const fresh = path.join(dir, 'new.env');
  assert.equal(ensureSessionSecret(fresh, generate), 'secret-2');
  assert.equal(fs.readFileSync(fresh, 'utf8'), 'SESSION_SECRET=secret-2\n');
});
