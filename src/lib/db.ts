import fs from 'node:fs';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import postgres from 'postgres';

/** A transaction's handle: postgres.js 3.4.9 gives it queries and unsafe, no begin (so helpers that take one never begin). */
export interface Tx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows are typed per query
  <T = any>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  unsafe(query: string): Promise<unknown>;
}

/** The slice of postgres.js the app uses: tagged-template queries, transactions, raw multi-statement SQL. */
export interface Sql extends Tx {
  begin<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/** A connection a script opens and closes itself. */
export type Client = Sql & { end(): Promise<void> };

/** `pnpm dev`'s database: `pglite:<folder>` names a PGlite data folder instead of a Postgres server. */
const LOCAL = 'pglite:';

/** True when DATABASE_URL is `pnpm dev`'s local PGlite database. */
export const isLocalDatabase = (url = process.env.DATABASE_URL) => !!url?.startsWith(LOCAL);

export const localDatabaseUrl = (folder: string) => `${LOCAL}${folder}`;

/** postgres.js's surface (see Sql) over PGlite: the test suite's database, and `pnpm dev`'s. */
export function fromPglite(db: PGlite): Sql {
  const sql = queries(db) as Sql;
  sql.begin = (fn) => db.transaction((tx) => fn(queries(tx)));
  return sql;
}

/** A transaction's handle, like postgres.js 3.4.9's: queries and unsafe, no begin. */
function queries(db: PGlite | Transaction): Tx {
  const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, s, i) => `${out}$${i}${s}`);
    return (await db.query(text, values)).rows;
  }) as Tx;
  q.unsafe = (query) => db.exec(query);
  return q;
}

// The Vercel file trace follows a constant specifier but not a parameter, so PGlite never ships to production.
const load = (specifier: string) => import(/* @vite-ignore */ specifier);
const OPEN = Symbol.for('scholaros.pglite');
// On globalThis: the workflow routes bundle their own copy of this module, and one folder must have one PGlite.
const open = ((globalThis as { [OPEN]?: Map<string, Promise<PGlite>> })[OPEN] ??= new Map());

/** PGlite has no lock of its own, and two processes on one folder corrupt it. */
function lock(folder: string): void {
  const file = `${folder}.lock`;
  const pid = Number(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 0);
  if (pid && pid !== process.pid && alive(pid)) {
    throw new Error(
      `The local database ${folder} is open in another process (pid ${pid}). Stop it first, or delete ${file} if no ScholarOS server is running.`,
    );
  }
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, String(process.pid));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function pglite(folder: string): Promise<PGlite> {
  let db = open.get(folder);
  if (!db) {
    db = (async () => {
      lock(folder);
      const { PGlite } = (await load('@electric-sql/pglite')) as typeof import('@electric-sql/pglite');
      return PGlite.create(folder);
    })();
    open.set(folder, db);
    db.catch(() => open.delete(folder));
  }
  return db;
}

/** PGlite in `folder`, opened on the first query; after end() the next query opens it again. */
function localSql(folder: string): Client {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) =>
    fromPglite(await pglite(folder))(strings, ...values)) as Client;
  sql.unsafe = async (query) => fromPglite(await pglite(folder)).unsafe(query);
  sql.begin = async (fn) => fromPglite(await pglite(folder)).begin(fn);
  sql.end = async () => {
    const db = open.get(folder);
    if (!db) return;
    open.delete(folder);
    await (await db).close();
    fs.rmSync(`${folder}.lock`, { force: true });
  };
  return sql;
}

/** For scripts: one connection to `url`, a Postgres server or `pglite:<folder>`. */
export function connect(url: string): Client {
  if (isLocalDatabase(url)) return localSql(url.slice(LOCAL.length));
  return postgres(url, { max: 1, prepare: false }) as unknown as Client;
}

let pool: Sql | null = null;
let testSql: Sql | null = null;

/** Tests swap the connection; production code never calls this. */
export function setSqlForTests(sql: Sql | null): void {
  testSql = sql;
}

/** One small pool per function instance, created on first use (the build never connects). */
export function getSql(): Sql {
  if (testSql) return testSql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (isLocalDatabase(url)) return (pool ??= connect(url));
  // prepare: false — poolers in transaction mode (Neon, PgBouncer) can't keep prepared statements.
  return (pool ??= postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 5, // an unreachable database answers 503 in seconds, not after the 30 s default
    prepare: false,
  }) as unknown as Sql);
}

const UNREACHABLE = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  '57P01', // admin shutdown
  '57P03', // cannot connect now
  '53300', // too many connections
]);

/** True for "the database can't be reached right now", as opposed to a bad query. */
export function isUnreachable(e: unknown): boolean {
  return typeof e === 'object' && e !== null && UNREACHABLE.has(String((e as { code?: unknown }).code));
}
