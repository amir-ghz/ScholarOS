import type { APIRoute } from 'astro';
import { MIGRATION_MESSAGE, MigrationMissingError, createFirstAccount, signIn } from '../../../../lib/admin/accounts';
import { HttpError, json } from '../../../../lib/admin/http';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, sealSession, sessionSecret } from '../../../../lib/admin/session';
import { adoptFirstOwner } from '../../../../lib/admin/settings';
import { getSql, isLocalDatabase } from '../../../../lib/db';
import { ensureOwner } from '../../../../lib/local-dev';
import { getMode } from '../../../../lib/mode';

export const prerender = false;

/**
 * `pnpm dev`'s first-run sign-up: creates the site owner while the local database has no account, then signs it in.
 * Only on the local database: on a deployment the first visitor would claim the site, so there the login screen says
 * how to create the account instead (ADMIN_PASSWORD, or `pnpm admin:create-user --production`).
 */
export const POST: APIRoute = async (ctx) => {
  if (getMode() !== 'postgres' || !isLocalDatabase()) return json({ error: 'Not found' }, 404);
  let body: unknown;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: 'The request body must be JSON' }, 400);
  }
  const { username, name, password } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  try {
    const sql = getSql();
    const created = await createFirstAccount(sql, username, name, password);
    adoptFirstOwner(await ensureOwner(sql));
    const result = await signIn(sql, created.username, password, new Date(), '');
    if (!result.ok) return json({ error: 'Account created; sign in to continue' }, 500);
    const { account } = result;
    ctx.cookies.set(
      SESSION_COOKIE,
      await sealSession(
        { login: account.username, name: account.name, avatar: '', provider: 'password', version: account.version },
        sessionSecret(),
      ),
      SESSION_COOKIE_OPTIONS,
    );
    return json({ ok: true, username: account.username });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof MigrationMissingError) return json({ error: MIGRATION_MESSAGE }, 503);
    throw e;
  }
};
