import { addDemoViews, removeDemoViews } from '../../../../lib/analytics/demo';
import { getSql, isLocalDatabase } from '../../../../lib/db';
import { HttpError, json, route } from '../../../../lib/admin/http';

export const prerender = false;

/** Sample views exist only on `pnpm dev`'s local database: a deployed site's numbers are never mixed with them. */
function localOnly() {
  if (!isLocalDatabase()) throw new HttpError(404, 'Sample data is only for the local database (pnpm dev)');
}

/** POST: add 90 days of sample page views. */
export const POST = route(async () => {
  localOnly();
  return json({ added: await addDemoViews(getSql()) });
});

/** DELETE: remove every sample view (real ones stay). */
export const DELETE = route(async () => {
  localOnly();
  return json({ removed: await removeDemoViews(getSql()) });
});
