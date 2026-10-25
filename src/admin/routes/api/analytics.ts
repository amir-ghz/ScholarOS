import { analyticsReport, isRange } from '../../../lib/analytics/report';
import { getSql } from '../../../lib/db';
import { HttpError, json, route } from '../../../lib/admin/http';
import { getMode } from '../../../lib/mode';

export const prerender = false;

/** GET ?range=7d|30d|90d|12m: the site's visitors, pages, sources, places and devices (src/lib/analytics). */
export const GET = route(async ({ url }) => {
  if (getMode() !== 'postgres') throw new HttpError(404, 'Analytics needs the site database (Postgres mode)');
  const range = url.searchParams.get('range') ?? '30d';
  if (!isRange(range)) throw new HttpError(400, 'range must be 7d, 30d, 90d or 12m');
  return json(await analyticsReport(getSql(), range));
});
