import type { Sql } from '../db';

/**
 * Sample page views for trying the Analytics screens on `pnpm dev`'s local database: 90 days of plausible traffic
 * with a weekly rhythm and slow growth. Every sample visitor hash starts with DEMO, so removing them is exact.
 */
export const DEMO = 'demo-';

type Weighted<T> = [T, number][];
function pick<T>(items: Weighted<T>, r: () => number): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [item, w] of items) if ((x -= w) < 0) return item;
  return items[0]![0];
}
/** A small seeded PRNG (mulberry32), so a run is reproducible in tests. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATHS: Weighted<string> = [
  ['/', 30],
  ['/publications', 18],
  ['/blog', 8],
  ['/cv', 10],
  ['/people', 6],
  ['/research', 7],
  ['/news', 4],
  ['/projects', 3],
  ['/talks', 2],
  ['/contact', 2],
];
const PLACES: Weighted<[string, string, string]> = [
  [['US', 'MA', 'Boston'], 14],
  [['US', 'CA', 'San Francisco'], 9],
  [['US', 'MO', 'St. Louis'], 8],
  [['GB', 'ENG', 'London'], 8],
  [['DE', 'BE', 'Berlin'], 7],
  [['CA', 'ON', 'Toronto'], 5],
  [['IN', 'KA', 'Bengaluru'], 6],
  [['CN', 'BJ', 'Beijing'], 4],
  [['FR', 'IDF', 'Paris'], 4],
  [['NL', 'NH', 'Amsterdam'], 3],
  [['JP', '13', 'Tokyo'], 3],
  [['IR', '23', 'Tehran'], 3],
  [['BR', 'SP', 'São Paulo'], 2],
  [['AU', 'NSW', 'Sydney'], 2],
  [['KR', '11', 'Seoul'], 2],
  [['CH', 'ZH', 'Zurich'], 2],
];
const SOURCES: Weighted<[string, string]> = [
  ['direct', ''],
  ['search', 'google.com'],
  ['search', 'scholar.google.com'],
  ['search', 'bing.com'],
  ['social', 'bsky.app'],
  ['social', 'linkedin.com'],
  ['social', 't.co'],
  ['referral', 'github.com'],
  ['referral', 'arxiv.org'],
  ['email', ''],
].map((s, i) => [s as [string, string], [34, 20, 12, 3, 6, 6, 4, 6, 6, 3][i]!]);
const CLIENTS: Weighted<[string, string, string]> = [
  [['desktop', 'Chrome', 'macOS'], 24],
  [['desktop', 'Chrome', 'Windows'], 18],
  [['desktop', 'Safari', 'macOS'], 12],
  [['desktop', 'Firefox', 'Linux'], 6],
  [['desktop', 'Edge', 'Windows'], 7],
  [['mobile', 'Safari', 'iOS'], 16],
  [['mobile', 'Chrome', 'Android'], 11],
  [['tablet', 'Safari', 'iOS'], 3],
  [['desktop', 'Opera', 'Windows'], 1],
];

/** Inserts sample views for the `days` before `now`; returns how many. */
export async function addDemoViews(sql: Sql, now = new Date(), days = 90, seed = 7): Promise<number> {
  const r = prng(seed);
  const rows: unknown[][] = [];
  for (let d = days - 1; d >= 0; d--) {
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d);
    const weekday = new Date(dayStart).getUTCDay();
    const base = 22 + (days - d) * 0.35; // slow growth
    const visitors = Math.round(base * (weekday === 0 || weekday === 6 ? 0.6 : 1) * (0.8 + r() * 0.45));
    for (let v = 0; v < visitors; v++) {
      const [country, region, city] = pick(PLACES, r);
      const [channel, referrer] = pick(SOURCES, r);
      const [device, browser, os] = pick(CLIENTS, r);
      const visitor = `${DEMO}${d}-${v}-${Math.floor(r() * 1e9).toString(36)}`;
      const pages = 1 + Math.floor(r() ** 2 * 4);
      let at = dayStart + Math.floor((7 + r() * 15) * 3_600_000);
      if (d === 0) at = Math.min(at, now.getTime() - 60_000);
      for (let p = 0; p < pages; p++) {
        rows.push([
          new Date(at),
          p === 0 ? pick(PATHS, r) : pick(PATHS.slice(1), r),
          visitor,
          p === 0 ? referrer : '',
          p === 0 ? channel : 'direct',
          country,
          region,
          city,
          device,
          browser,
          os,
          device === 'mobile' ? 390 : 1440,
        ]);
        at += Math.floor(20_000 + r() * 180_000);
      }
    }
  }
  // A visitor or two "right now", for the live count.
  rows.push([
    new Date(now.getTime() - 90_000),
    '/publications',
    `${DEMO}live`,
    '',
    'direct',
    'US',
    'MO',
    'St. Louis',
    'desktop',
    'Chrome',
    'macOS',
    1440,
  ]);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const col = (k: number) => chunk.map((row) => row[k]);
    await sql`
      insert into page_views (at, path, visitor, referrer, channel, country, region, city, device, browser, os, screen)
      select * from unnest(${col(0)}::timestamptz[], ${col(1)}::text[], ${col(2)}::text[], ${col(3)}::text[],
        ${col(4)}::text[], ${col(5)}::text[], ${col(6)}::text[], ${col(7)}::text[], ${col(8)}::text[],
        ${col(9)}::text[], ${col(10)}::text[], ${col(11)}::int[])`;
  }
  return rows.length;
}

/** Removes every sample view; real ones stay. */
export async function removeDemoViews(sql: Sql): Promise<number> {
  const gone = await sql<{ id: number }>`delete from page_views where visitor like ${`${DEMO}%`} returning id`;
  return gone.length;
}
