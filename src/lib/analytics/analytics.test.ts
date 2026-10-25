import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import type { Sql } from '../db';
import { RETENTION_DAYS, dailySalt, rateLimited, recordView, type Visit } from './collect';
import { channelOf, normalizePath, parseUserAgent, referrerHost } from './parse';
import { analyticsReport, frontMatterTitle, pageTitle } from './report';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0';
const FIREFOX_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

test('User-Agent: browser, OS and device; bots and empty agents are bots', () => {
  assert.deepEqual(parseUserAgent(CHROME_MAC), { bot: false, device: 'desktop', browser: 'Chrome', os: 'macOS' });
  assert.deepEqual(parseUserAgent(SAFARI_IPHONE), { bot: false, device: 'mobile', browser: 'Safari', os: 'iOS' });
  assert.equal(parseUserAgent(EDGE_WIN).browser, 'Edge');
  assert.deepEqual(parseUserAgent(FIREFOX_IPAD), { bot: false, device: 'tablet', browser: 'Firefox', os: 'iOS' });
  assert.equal(parseUserAgent(GOOGLEBOT).bot, true);
  assert.equal(parseUserAgent('').bot, true);
  assert.equal(parseUserAgent('curl/8.4.0').bot, true);
});

test('channels: campaign tags, then the referrer kind; this site and no referrer are direct', () => {
  assert.equal(referrerHost('https://www.google.com/search?q=x', 'site.test'), 'google.com');
  assert.equal(referrerHost('https://site.test/blog', 'site.test'), '');
  assert.equal(referrerHost('not a url', 'site.test'), '');
  assert.equal(channelOf('google.com', {}), 'search');
  assert.equal(channelOf('scholar.google.com', {}), 'search');
  assert.equal(channelOf('t.co', {}), 'social');
  assert.equal(channelOf('bsky.app', {}), 'social');
  assert.equal(channelOf('example.edu', {}), 'referral');
  assert.equal(channelOf('', {}), 'direct');
  assert.equal(channelOf('google.com', { source: 'newsletter', medium: 'email' }), 'email');
  assert.equal(channelOf('', { source: 'conference' }), 'campaign');
});

test('paths: no query, no trailing slash, decoded, only absolute paths', () => {
  assert.equal(normalizePath('/blog/post/?x=1#top'), '/blog/post');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('/caf%C3%A9'), '/café');
  assert.equal(normalizePath('https://evil.test/x'), null);
  assert.equal(normalizePath(42 as unknown as string), null);
});

test('rate limit: 60 views a minute per address, then a fresh minute', () => {
  const t = 1_000_000;
  for (let i = 0; i < 60; i++) assert.equal(rateLimited('203.0.113.9', t + i), false);
  assert.equal(rateLimited('203.0.113.9', t + 61), true);
  assert.equal(rateLimited('203.0.113.9', t + 61_000), false);
});

let sql: Sql;
let ipSeq = 0;
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
});
const visit = (over: Partial<Visit> = {}): Visit => ({
  ip: `198.51.100.${++ipSeq % 250}`,
  ua: CHROME_MAC,
  optOut: false,
  siteHost: 'site.test',
  adminPath: 'admin',
  ...over,
});

test('recordView: stores a view without the IP; skips opt-outs, bots, admin and API paths', async () => {
  const now = new Date('2026-10-20T12:00:00Z');
  assert.equal(
    await recordView(
      sql,
      { p: '/blog/hello', r: 'https://t.co/abc', w: 1440, l: 'en-US' },
      visit({ country: 'DE', city: 'Berlin' }),
      now,
    ),
    'recorded',
  );
  assert.equal(await recordView(sql, { p: '/' }, visit({ optOut: true }), now), 'opt-out');
  assert.equal(await recordView(sql, { p: '/' }, visit({ ua: GOOGLEBOT }), now), 'bot');
  assert.equal(await recordView(sql, { p: '/admin/posts' }, visit(), now), 'ignored');
  assert.equal(await recordView(sql, { p: '/api/collect' }, visit(), now), 'ignored');
  const rows = await sql`select * from page_views`;
  assert.equal(rows.length, 1);
  const [r] = rows;
  assert.equal(r.path, '/blog/hello');
  assert.equal(r.channel, 'social');
  assert.equal(r.referrer, 't.co');
  assert.equal(r.country, 'DE');
  assert.equal(r.city, 'Berlin');
  assert.equal(r.screen, 1440);
  assert.match(r.visitor, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(r).includes('198.51.100'), 'the IP is never stored');
});

test('visitors: the same person counts once a day and gets a new hash the next day', async () => {
  const v = visit({ ip: '192.0.2.1' });
  const day1 = new Date('2026-10-20T08:00:00Z');
  await recordView(sql, { p: '/' }, v, day1);
  await recordView(sql, { p: '/cv' }, v, new Date('2026-10-20T09:00:00Z'));
  await recordView(sql, { p: '/' }, v, new Date('2026-10-21T08:00:00Z'));
  const hashes = await sql<{ visitor: string }>`select visitor from page_views order by at`;
  assert.equal(hashes[0].visitor, hashes[1].visitor);
  assert.notEqual(hashes[1].visitor, hashes[2].visitor);
  const salts = await sql`select day from analytics_salts`;
  assert.equal(salts.length, 1, "yesterday's salt is gone once today's exists");
});

test(`retention: a new day's salt drops views older than ${RETENTION_DAYS} days`, async () => {
  const now = new Date('2026-10-20T12:00:00Z');
  await sql`insert into page_views (at, path, visitor, channel, device, browser, os)
    values (${new Date(now.getTime() - (RETENTION_DAYS + 1) * 86_400_000)}, '/', 'x', 'direct', 'desktop', 'Chrome', 'macOS'),
           (${new Date(now.getTime() - 10 * 86_400_000)}, '/', 'y', 'direct', 'desktop', 'Chrome', 'macOS')`;
  await dailySalt(sql, now);
  const left = await sql<{ visitor: string }>`select visitor from page_views`;
  assert.deepEqual(
    left.map((r) => r.visitor),
    ['y'],
  );
});

test('report: totals with the previous period, series, pages with titles, sources, places, devices', async () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const at = (daysAgo: number, h = 10) => new Date(now.getTime() - daysAgo * 86_400_000 + (h - 12) * 3_600_000);
  await sql`insert into documents (path, content) values
    ('src/content/posts/hello.md', '---\ntitle: ''Hello, world''\n---\nbody'),
    ('src/content/people/jane.md', '---\nname: Jane Smith\ntitle: Professor\n---\n')`;
  const views: [number, string, string, Partial<Visit>, string?][] = [
    [1, '/', '10.0.0.1', { country: 'US', city: 'Boston' }, 'https://www.google.com/'],
    [1, '/blog/hello', '10.0.0.1', { country: 'US', city: 'Boston' }],
    [2, '/blog/hello', '10.0.0.2', { country: 'DE', city: 'Berlin', ua: SAFARI_IPHONE }, 'https://t.co/x'],
    [3, '/people/jane', '10.0.0.3', { country: 'US' }],
    [40, '/', '10.0.0.4', { country: 'US' }], // the previous 30 days
  ];
  for (const [d, p, ip, over, r] of views) await recordView(sql, { p, r }, visit({ ip, ...over }), at(d));
  await recordView(sql, { p: '/cv' }, visit({ ip: '10.0.0.9', country: 'FR' }), new Date(now.getTime() - 60_000));

  const r = await analyticsReport(sql, '30d', now);
  assert.deepEqual(r.totals, { visitors: 4, views: 5, bounce: 75, viewsPerVisitor: 1.3 });
  assert.deepEqual(r.previous, { visitors: 1, views: 1, bounce: 100 });
  assert.equal(r.live, 1);
  assert.equal(r.series.length, 30);
  assert.equal(r.series.at(-1)!.at, '2026-10-20');
  assert.equal(
    r.series.reduce((s, p) => s + p.views, 0),
    5,
  );
  assert.deepEqual(
    r.pages.map((p) => [p.path, p.title, p.views]),
    [
      ['/blog/hello', 'Hello, world', 2],
      ['/', 'Home', 1],
      ['/cv', 'CV', 1],
      ['/people/jane', 'Jane Smith', 1],
    ],
  );
  assert.deepEqual(r.sections[0], { name: 'Blog', views: 2 });
  assert.deepEqual(Object.fromEntries(r.channels.map((c) => [c.name, c.visitors])), {
    direct: 3,
    search: 1,
    social: 1,
  });
  assert.deepEqual(r.referrers.map((c) => c.name).sort(), ['google.com', 't.co']);
  assert.deepEqual(
    r.countries.find((c) => c.name === 'US'),
    { name: 'US', visitors: 2, previous: 1 },
  );
  assert.deepEqual(r.cities[0], { name: 'Berlin', country: 'DE', visitors: 1 });
  assert.deepEqual(Object.fromEntries(r.devices.map((d) => [d.name, d.visitors])), { desktop: 3, mobile: 1 });

  const year = await analyticsReport(sql, '12m', now);
  assert.equal(year.series.length, 12);
  assert.equal(year.series.at(-1)!.at, '2026-10');
});

test('titles: name before title in front matter; sections and plain paths otherwise', () => {
  assert.equal(frontMatterTitle("---\nname: 'Alex Chen'\ntitle: 'Postdoc'\n---\n"), 'Alex Chen');
  assert.equal(frontMatterTitle('---\ntitle: "A post"\n---\n'), 'A post');
  assert.equal(frontMatterTitle('no front matter'), null);
  assert.equal(pageTitle('/publications', new Map()), 'Publications');
  assert.equal(pageTitle('/blog/missing', new Map()), '/blog/missing');
});

test('sample data: adds plausible views on the local database and removes only those', async () => {
  const { addDemoViews, removeDemoViews } = await import('./demo');
  const now = new Date('2026-10-20T12:00:00Z');
  await recordView(sql, { p: '/' }, visit({ ip: '192.0.2.50' }), now);
  const added = await addDemoViews(sql, now, 30);
  assert.ok(added > 500, `added ${added}`);
  const r = await analyticsReport(sql, '30d', now);
  assert.ok(r.totals.visitors > 300);
  assert.ok(r.countries.length > 8);
  assert.ok(r.live >= 1);
  assert.equal(await removeDemoViews(sql), added);
  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from page_views`;
  assert.equal(n, 1, 'the real view stays');
});
