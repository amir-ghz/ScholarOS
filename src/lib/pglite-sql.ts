import { PGlite } from '@electric-sql/pglite';
import { fromPglite, type Sql } from './db';

/** Tests: an in-process Postgres behind the postgres.js surface the app uses (see Sql). */
export function pgliteSql(db: PGlite = new PGlite()): Sql {
  return fromPglite(db);
}
