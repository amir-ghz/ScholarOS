import type { Sql } from '../db';

/** Ranges the admin offers; each is compared with the same length of time just before it. */
export const RANGES = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 } as const;
export type Range = keyof typeof RANGES;
export const isRange = (r: unknown): r is Range => typeof r === 'string' && r in RANGES;

export interface Count {
  name: string;
  visitors: number;
}
export interface AnalyticsReport {
  range: Range;
  from: string;
  to: string;
  totals: { visitors: number; views: number; bounce: number; viewsPerVisitor: number };
  previous: { visitors: number; views: number; bounce: number };
  /** Visitors in the last 5 minutes. */
  live: number;
  /** One point per day (per month for 12m), gaps filled with zeros. */
  series: { at: string; visitors: number; views: number }[];
  pages: { path: string; title: string; views: number; visitors: number }[];
  /** Views by the part of the site: Home, Blog, Publications, … */
  sections: { name: string; views: number }[];
  channels: Count[];
  referrers: Count[];
  countries: (Count & { previous: number })[];
  cities: (Count & { country: string | null })[];
  devices: Count[];
  browsers: Count[];
  os: Count[];
}

const DAY = 86_400_000;
const SECTION_NAMES: Record<string, string> = {
  '': 'Home',
  blog: 'Blog',
  publications: 'Publications',
  cv: 'CV',
  people: 'People',
  news: 'News',
  projects: 'Projects',
  talks: 'Talks',
  research: 'Research',
  positions: 'Positions',
  readings: 'Readings',
  notes: 'Notes',
  contact: 'Contact',
  repositories: 'Repositories',
};
/** Public URL prefix → the collection whose entry it shows (titles for top pages). */
const COLLECTION_OF: Record<string, string> = {
  blog: 'posts',
  news: 'announcements',
  people: 'people',
  projects: 'projects',
  positions: 'positions',
};

/** An entry's display name from its front matter: `name` (people) before `title`. */
export function frontMatterTitle(content: string): string | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? '';
  const line = /^name:\s*(.+)$/m.exec(fm) ?? /^title:\s*(.+)$/m.exec(fm);
  return line ? line[1].trim().replace(/^(['"])(.*)\1$/, '$2') : null;
}

/** A readable name for a public path: the entry's title, else the section, else the path. */
export function pageTitle(path: string, titles: Map<string, string>): string {
  const [, first = '', second] = path.split('/');
  if (second && titles.has(`${first}/${second}`)) return titles.get(`${first}/${second}`)!;
  if (!second && first in SECTION_NAMES) return SECTION_NAMES[first]!;
  return path;
}

const n = (v: unknown) => Number(v ?? 0);

export async function analyticsReport(sql: Sql, range: Range, now = new Date()): Promise<AnalyticsReport> {
  const days = RANGES[range];
  const monthly = range === '12m';
  const to = now;
  const from = new Date(now.getTime() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);

  const totals = async (a: Date, b: Date) => {
    const [t] = await sql<{ views: number; visitors: number; bounced: number }>`
      select count(*)::int as views, count(distinct visitor)::int as visitors,
        (select count(*)::int from (
          select visitor from page_views where at >= ${a} and at < ${b} group by visitor having count(*) = 1
        ) one) as bounced
      from page_views where at >= ${a} and at < ${b}`;
    const visitors = n(t?.visitors);
    return { views: n(t?.views), visitors, bounce: visitors ? Math.round((n(t?.bounced) / visitors) * 1000) / 10 : 0 };
  };
  // One parameterised query per column: no identifiers or values are ever spliced into SQL text.
  const COUNTS = {
    channel: (a: Date, b: Date) => sql<Count>`
      select channel as name, count(distinct visitor)::int as visitors from page_views
      where at >= ${a} and at < ${b} group by 1 order by 2 desc, 1 limit 10`,
    country: (a: Date, b: Date) => sql<Count>`
      select coalesce(country, 'Unknown') as name, count(distinct visitor)::int as visitors from page_views
      where at >= ${a} and at < ${b} group by 1 order by 2 desc, 1 limit 250`,
    device: (a: Date, b: Date) => sql<Count>`
      select device as name, count(distinct visitor)::int as visitors from page_views
      where at >= ${a} and at < ${b} group by 1 order by 2 desc, 1 limit 10`,
    browser: (a: Date, b: Date) => sql<Count>`
      select browser as name, count(distinct visitor)::int as visitors from page_views
      where at >= ${a} and at < ${b} group by 1 order by 2 desc, 1 limit 10`,
    os: (a: Date, b: Date) => sql<Count>`
      select os as name, count(distinct visitor)::int as visitors from page_views
      where at >= ${a} and at < ${b} group by 1 order by 2 desc, 1 limit 10`,
  };
  const seriesQuery = monthly
    ? sql<{ b: Date | string; views: number; visitors: number }>`
        select date_trunc('month', at at time zone 'UTC') as b, count(*)::int as views,
          count(distinct visitor)::int as visitors
        from page_views where at >= ${from} and at < ${to} group by 1 order by 1`
    : sql<{ b: Date | string; views: number; visitors: number }>`
        select date_trunc('day', at at time zone 'UTC') as b, count(*)::int as views,
          count(distinct visitor)::int as visitors
        from page_views where at >= ${from} and at < ${to} group by 1 order by 1`;

  const [
    current,
    previous,
    liveRow,
    seriesRows,
    pageRows,
    sectionRows,
    channels,
    referrerRows,
    countryRows,
    prevCountries,
    cityRows,
    devices,
    browsers,
    os,
  ] = await Promise.all([
    totals(from, to),
    totals(prevFrom, from),
    sql<{ live: number }>`select count(distinct visitor)::int as live from page_views
        where at >= ${new Date(now.getTime() - 5 * 60_000)}`,
    seriesQuery,
    sql<{ path: string; views: number; visitors: number }>`
        select path, count(*)::int as views, count(distinct visitor)::int as visitors from page_views
        where at >= ${from} and at < ${to} group by path order by views desc, path limit 10`,
    sql<{ seg: string; views: number }>`
        select split_part(path, '/', 2) as seg, count(*)::int as views from page_views
        where at >= ${from} and at < ${to} group by 1 order by 2 desc`,
    COUNTS.channel(from, to),
    sql<Count>`
        select referrer as name, count(distinct visitor)::int as visitors from page_views
        where at >= ${from} and at < ${to} and referrer <> '' group by 1 order by 2 desc, 1 limit 10`,
    COUNTS.country(from, to),
    sql<{ name: string; visitors: number }>`
        select country as name, count(distinct visitor)::int as visitors from page_views
        where at >= ${prevFrom} and at < ${from} and country is not null group by 1`,
    sql<{ name: string; country: string | null; visitors: number }>`
        select city as name, country, count(distinct visitor)::int as visitors from page_views
        where at >= ${from} and at < ${to} and city is not null group by 1, 2 order by 3 desc, 1 limit 10`,
    COUNTS.device(from, to),
    COUNTS.browser(from, to),
    COUNTS.os(from, to),
  ]);

  // Titles of the entries behind the top pages.
  const docPaths = pageRows.flatMap((r) => {
    const [, first = '', second] = r.path.split('/');
    const col = COLLECTION_OF[first];
    return col && second ? [`src/content/${col}/${second}.md`, `src/content/${col}/${second}.mdx`] : [];
  });
  const titles = new Map<string, string>();
  if (docPaths.length) {
    const docs = await sql<{ path: string; content: string }>`
      select path, content from documents where path = any(${docPaths})`;
    for (const d of docs) {
      const m = /^src\/content\/([^/]+)\/([^/]+)\.mdx?$/.exec(d.path);
      const prefix = Object.keys(COLLECTION_OF).find((k) => COLLECTION_OF[k] === m?.[1]);
      const title = frontMatterTitle(d.content);
      if (m && prefix && title) titles.set(`${prefix}/${m[2]}`, title);
    }
  }

  // Fill the series so the chart has every day (or month) of the range.
  const byKey = new Map(
    seriesRows.map((r) => [
      new Date(r.b instanceof Date ? r.b : `${String(r.b).replace(' ', 'T')}Z`)
        .toISOString()
        .slice(0, monthly ? 7 : 10),
      r,
    ]),
  );
  const series: AnalyticsReport['series'] = [];
  if (monthly) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    for (let i = 0; i < 12; i++, d.setUTCMonth(d.getUTCMonth() + 1)) {
      const key = d.toISOString().slice(0, 7);
      series.push({ at: key, visitors: n(byKey.get(key)?.visitors), views: n(byKey.get(key)?.views) });
    }
  } else {
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10);
      series.push({ at: key, visitors: n(byKey.get(key)?.visitors), views: n(byKey.get(key)?.views) });
    }
  }

  const sections = new Map<string, number>();
  for (const r of sectionRows) {
    const name = SECTION_NAMES[r.seg] ?? 'Other';
    sections.set(name, (sections.get(name) ?? 0) + n(r.views));
  }
  const prevByCountry = new Map(prevCountries.map((r) => [r.name, n(r.visitors)]));

  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      ...current,
      viewsPerVisitor: current.visitors ? Math.round((current.views / current.visitors) * 10) / 10 : 0,
    },
    previous,
    live: n(liveRow[0]?.live),
    series,
    pages: pageRows.map((r) => ({ ...r, title: pageTitle(r.path, titles) })),
    sections: [...sections].map(([name, views]) => ({ name, views })).sort((a, b) => b.views - a.views),
    channels,
    referrers: referrerRows,
    countries: countryRows.map((r) => ({ ...r, previous: prevByCountry.get(r.name) ?? 0 })),
    cities: cityRows,
    devices,
    browsers,
    os,
  };
}
