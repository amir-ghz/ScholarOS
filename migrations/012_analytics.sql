-- First-party, cookieless site analytics (src/lib/analytics). One row per page view; no IP and no cookie is kept.
-- `visitor` is a hash of a salt that changes every day, the IP and the User-Agent, so a person can be counted once a
-- day but not followed across days. Country, region and city come from the host's geo headers (Vercel).
create table if not exists page_views (
  id bigserial primary key,
  at timestamptz not null default now(),
  path text not null,
  visitor text not null,
  referrer text not null default '', -- the referring host ('' when direct or from this site)
  channel text not null, -- direct | search | social | email | referral | campaign
  utm_source text,
  country text, -- ISO 3166-1 alpha-2
  region text,
  city text,
  device text not null, -- desktop | mobile | tablet
  browser text not null,
  os text not null,
  lang text,
  screen int
);
create index if not exists page_views_at on page_views (at);
create index if not exists page_views_path_at on page_views (path, at);

-- The day's random salt for visitor hashes; yesterday's row is deleted once a new day's salt exists.
create table if not exists analytics_salts (
  day date primary key,
  salt text not null
);
