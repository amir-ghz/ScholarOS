import type { APIRoute } from 'astro';
import { SESSION_COOKIE, openSession } from '../admin/session';
import { adminSettings } from '../admin/settings';
import { getSql } from '../db';
import { recordView, type Beacon } from './collect';

export const prerender = false;

const NO_CONTENT = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST /api/collect (Postgres mode): one page view from the public pages' beacon. Always 204, whatever happened: the
 * beacon has no use for the answer, and it tells a prober nothing. Signed-in admins aren't counted.
 */
export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  const text = await request.text().catch(() => '');
  if (!text || text.length > 4096) return NO_CONTENT();
  let beacon: Beacon;
  try {
    beacon = JSON.parse(text) as Beacon;
  } catch {
    return NO_CONTENT();
  }
  const token = cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET ?? '';
  if (token && secret.length >= 32 && (await openSession(token, secret).catch(() => null))) return NO_CONTENT();

  const h = request.headers;
  let ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '';
  if (!ip) {
    try {
      ip = clientAddress;
    } catch {
      ip = '';
    }
  }
  const decode = (v: string | null) => {
    try {
      return v ? decodeURIComponent(v) : undefined;
    } catch {
      return undefined;
    }
  };
  try {
    await recordView(getSql(), beacon, {
      ip,
      ua: h.get('user-agent') ?? '',
      optOut: h.get('dnt') === '1' || h.get('sec-gpc') === '1',
      siteHost: new URL(request.url).hostname,
      country: h.get('x-vercel-ip-country')?.toUpperCase() || undefined,
      region: decode(h.get('x-vercel-ip-country-region')),
      city: decode(h.get('x-vercel-ip-city')),
      adminPath: adminSettings().adminPath,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[analytics] could not record a view', e);
  }
  return NO_CONTENT();
};
