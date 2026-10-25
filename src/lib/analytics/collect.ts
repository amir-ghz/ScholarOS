import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from '../db';
import { channelOf, normalizePath, parseUserAgent, referrerHost } from './parse';

/** What the public pages' beacon sends (src/components/astro/Collect.astro). */
export interface Beacon {
  /** location.pathname */
  p: string;
  /** document.referrer */
  r?: string;
  /** screen.width */
  w?: number;
  /** navigator.language */
  l?: string;
  /** utm_source / utm_medium / utm_campaign from the URL */
  u?: { source?: string; medium?: string; campaign?: string };
}

/** The request around the beacon, read by the route; nothing here is stored as-is. */
export interface Visit {
  ip: string;
  ua: string;
  /** DNT: 1 or Sec-GPC: 1 */
  optOut: boolean;
  siteHost: string;
  country?: string;
  region?: string;
  city?: string;
  /** Paths never counted: the admin, APIs, files. */
  adminPath: string;
}

export type Outcome = 'recorded' | 'opt-out' | 'bot' | 'ignored' | 'rate-limited';

/** Page views are kept this long; older rows go when a new day's salt is made (once a day). */
export const RETENTION_DAYS = 400;
const PER_MINUTE = 60;
const recent = new Map<string, { at: number; n: number }>();

/** At most PER_MINUTE views a minute per address, per server instance: a reload loop or a script can't flood the table. */
export function rateLimited(ip: string, now = Date.now()): boolean {
  const hit = recent.get(ip);
  if (!hit || now - hit.at > 60_000) {
    if (recent.size > 10_000) recent.clear();
    recent.set(ip, { at: now, n: 1 });
    return false;
  }
  hit.n += 1;
  return hit.n > PER_MINUTE;
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/** Today's salt, made on the first view of the day; that also drops older salts and views past RETENTION_DAYS. */
export async function dailySalt(sql: Sql, now: Date): Promise<string> {
  const day = dayOf(now);
  const [found] = await sql<{ salt: string }>`select salt from analytics_salts where day = ${day}::date`;
  if (found) return found.salt;
  const made = await sql<{ salt: string }>`
    insert into analytics_salts (day, salt) values (${day}::date, ${randomBytes(24).toString('hex')})
    on conflict (day) do nothing returning salt`;
  if (made.length) {
    await sql`delete from analytics_salts where day < ${day}::date`;
    await sql`delete from page_views where at < ${new Date(now.getTime() - RETENTION_DAYS * 86_400_000)}`;
    return made[0].salt;
  }
  const [raced] = await sql<{ salt: string }>`select salt from analytics_salts where day = ${day}::date`;
  return raced.salt;
}

const clip = (s: string | undefined, n: number) => (s ? s.trim().slice(0, n) || null : null);

/** Counts one page view, or says why not. */
export async function recordView(sql: Sql, beacon: Beacon, visit: Visit, now = new Date()): Promise<Outcome> {
  if (visit.optOut) return 'opt-out';
  const client = parseUserAgent(visit.ua);
  if (client.bot) return 'bot';
  const path = normalizePath(beacon?.p);
  if (!path || path === `/${visit.adminPath}` || path.startsWith(`/${visit.adminPath}/`) || path.startsWith('/api/'))
    return 'ignored';
  if (rateLimited(visit.ip, now.getTime())) return 'rate-limited';
  const salt = await dailySalt(sql, now);
  const visitor = createHash('sha256').update(`${salt}|${visit.ip}|${visit.ua}`).digest('hex').slice(0, 32);
  const host = referrerHost(typeof beacon.r === 'string' ? beacon.r : '', visit.siteHost);
  const utm = beacon.u && typeof beacon.u === 'object' ? beacon.u : {};
  const channel = channelOf(host, { source: utm.source, medium: utm.medium });
  const country = /^[A-Z]{2}$/.test(visit.country ?? '') ? visit.country! : null;
  const screen = Number.isInteger(beacon.w) && beacon.w! > 0 && beacon.w! < 20_000 ? beacon.w! : null;
  await sql`
    insert into page_views
      (at, path, visitor, referrer, channel, utm_source, country, region, city, device, browser, os, lang, screen)
    values (${now}, ${path}, ${visitor}, ${host.slice(0, 200)}, ${channel}, ${clip(utm.source, 100)}, ${country},
      ${clip(visit.region, 100)}, ${clip(visit.city, 100)}, ${client.device}, ${client.browser}, ${client.os},
      ${clip(typeof beacon.l === 'string' ? beacon.l : undefined, 20)}, ${screen})`;
  return 'recorded';
}
