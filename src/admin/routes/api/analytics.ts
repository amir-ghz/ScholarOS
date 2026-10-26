import { DEMO } from '../../../lib/analytics/demo';
import { analyticsReport, isRange } from '../../../lib/analytics/report';
import { getSql, isLocalDatabase } from '../../../lib/db';
import { HttpError, json, route } from '../../../lib/admin/http';
import { getMode } from '../../../lib/mode';

export const prerender = false;

/** GET ?range=7d|30d|90d|12m: the site's visitors, pages, sources, places and devices (src/lib/analytics). */
export const GET = route(async ({ url }) => {
  if (getMode() !== 'postgres') throw new HttpError(404, 'Analytics needs the site database (Postgres mode)');
  const range = url.searchParams.get('range') ?? '30d';
  if (!isRange(range)) throw new HttpError(400, 'range must be 7d, 30d, 90d or 12m');
  const sql = getSql();
  const local = isLocalDatabase();
  // `local`: pnpm dev, where the screen offers sample data; `demo`: sample views are in the numbers now.
  const demo = local
    ? (await sql<{ any: boolean }>`select exists (select 1 from page_views where visitor like ${`${DEMO}%`}) as any`)[0]
        ?.any
    : false;
  return json({ ...(await analyticsReport(sql, range)), local, demo: !!demo });
});
