/** What a page view's request says about the visitor: device, browser and OS from the User-Agent, and the channel. */

export interface Client {
  bot: boolean;
  device: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  os: string;
}

// Crawlers, link previewers, monitors and headless browsers: never counted.
const BOT =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview|vkshare|pinterest|lighthouse|pagespeed|headlesschrome|phantomjs|python-requests|curl\/|wget|httpclient|go-http-client|axios|node-fetch|monitor|uptime|preview/i;

/** Device, browser and OS by the usual User-Agent tokens; order matters (Edge and Opera also say "Chrome"). */
export function parseUserAgent(ua: string): Client {
  const s = ua || '';
  const bot = !s || BOT.test(s);
  const tablet = /iPad|Tablet|PlayBook|Silk|Kindle|(Android(?!.*Mobile))/i.test(s);
  const mobile = !tablet && /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Opera Mini/i.test(s);
  const browser = /Edg(e|A|iOS)?\//.test(s)
    ? 'Edge'
    : /OPR\/|Opera/.test(s)
      ? 'Opera'
      : /SamsungBrowser\//.test(s)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(s)
          ? 'Firefox'
          : /CriOS\/|Chrome\//.test(s)
            ? 'Chrome'
            : /Safari\//.test(s)
              ? 'Safari'
              : 'Other';
  const os = /Windows/.test(s)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(s)
      ? 'iOS'
      : /Mac OS X|Macintosh/.test(s)
        ? 'macOS'
        : /Android/.test(s)
          ? 'Android'
          : /CrOS/.test(s)
            ? 'ChromeOS'
            : /Linux/.test(s)
              ? 'Linux'
              : 'Other';
  return { bot, device: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', browser, os };
}

export type Channel = 'direct' | 'search' | 'social' | 'email' | 'referral' | 'campaign';

const SEARCH =
  /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|qwant|startpage|brave|kagi|scholar\.google|semanticscholar|perplexity)\./i;
const SOCIAL =
  /(^|\.)(t\.co|twitter\.com|x\.com|facebook\.com|fb\.me|linkedin\.com|lnkd\.in|reddit\.com|bsky\.app|mastodon\.|threads\.net|instagram\.com|youtube\.com|news\.ycombinator\.com|researchgate\.net|tiktok\.com)/i;
const EMAIL = /(^|\.)(mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com|mail\.proton\.me)$/i;

/** The referring host, or '' when there is none or it is this site itself. */
export function referrerHost(referrer: string, siteHost: string): string {
  if (!referrer) return '';
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
  return host === siteHost.toLowerCase().replace(/^www\./, '') ? '' : host;
}

/** Campaign tags win, then the referring host's kind; no referrer is direct. */
export function channelOf(host: string, utm: { source?: string; medium?: string }): Channel {
  const medium = (utm.medium ?? '').toLowerCase();
  if (medium === 'email' || medium === 'newsletter') return 'email';
  if (utm.source || medium) return medium === 'social' ? 'social' : 'campaign';
  if (!host) return 'direct';
  if (SEARCH.test(host)) return 'search';
  if (SOCIAL.test(host)) return 'social';
  if (EMAIL.test(host)) return 'email';
  return 'referral';
}

/** A public path as stored: no query or fragment, no trailing slash (except "/"), at most 300 characters. */
export function normalizePath(raw: string): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null;
  let p = raw.split(/[?#]/)[0]!;
  try {
    p = decodeURI(p);
  } catch {
    // keep it encoded
  }
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p.slice(0, 300) || '/';
}
