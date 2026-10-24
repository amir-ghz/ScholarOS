import { reactive } from 'vue';
import type { AdminCtx, CommitResult } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type ToastAction = { label: string; run: () => void };
export interface Toast {
  id: number;
  text: string;
  href?: string;
  action?: ToastAction;
  /** Errors render in the assertive live region and stay until dismissed. */
  error?: boolean;
  /** An error's technical part (a traceback, a long upstream message), behind "Technical details". */
  detail?: string;
}
export const toasts = reactive<Toast[]>([]);
let lastToast = 0;
const INFO_MS = 8000;

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/**
 * A notice in the corner. Plain notices leave after 8 s; a notice with a link (View commit) or an action (Undo, Retry)
 * stays until dismissed, so nobody has to beat a timer to use it (WCAG 2.2.1).
 */
export function toast(text: string, href?: string, action?: ToastAction): void {
  const id = ++lastToast;
  toasts.push({ id, text, href, action });
  if (!action && !href) setTimeout(() => dismissToast(id), INFO_MS);
}

/** Past this, an error's text is split: the first sentence shows, the rest goes behind "Technical details". */
const PLAIN_MAX = 220;
const TECHNICAL = /Traceback \(most recent call last\)|File "[^"]+", line \d+|\n\s+at |\n\w*(Error|Exception): /;

/**
 * An error's sentence and its technical part. A message with a stack trace or traceback, or longer than PLAIN_MAX,
 * keeps a short lead ("CV renderer failed (exit 1)." from "CV renderer failed (exit 1): Traceback…", else the first
 * sentence) and the whole message goes to `detail`.
 */
export function splitError(message: string): { text: string; detail?: string } {
  const all = message.trim() || 'Something went wrong.';
  const technical = TECHNICAL.test(all);
  if (all.length <= PLAIN_MAX && !technical) return { text: all };
  let text = all.split('\n')[0].trim();
  const colon = text.indexOf(': ');
  if (technical && colon > 0) text = text.slice(0, colon);
  else if (text.length > PLAIN_MAX) {
    const cut = text.lastIndexOf('. ', PLAIN_MAX);
    text = cut > 40 ? text.slice(0, cut) : `${text.slice(0, PLAIN_MAX).trimEnd()}…`;
  }
  return { text: /[.…!?]$/.test(text) ? text : `${text}.`, detail: all };
}

/** A failure: announced assertively, kept until dismissed. `action` offers the recovery, e.g. Retry. */
export function toastError(message: string, action?: ToastAction): void {
  toasts.push({ id: ++lastToast, ...splitError(message), action, error: true });
}

/**
 * Set by AdminShell from the page context and `me`; `outage` is the persistent "database unreachable" banner,
 * `careerReady` the job-search owner's count of postings waiting for approval (null: not the owner, or not known yet).
 */
export const session = reactive({ mode: 'git' as AdminCtx['mode'], outage: '', careerReady: null as number | null });

export function committed(result: Pick<CommitResult, 'url' | 'warning' | 'tags' | 'detail'>): void {
  if (result.warning === 'cache-purge-failed') {
    const tags = result.tags ?? [];
    return toastError('Published, but the page cache could not be refreshed: visitors may see the old version.', {
      label: 'Retry refresh',
      run: () => void api('cache/purge', { body: { tags } }).then(() => toast('Cache refreshed'), report),
    });
  }
  if (result.warning === 'pdf-failed')
    return toastError(`Saved; PDF generation failed: ${result.detail ?? 'unknown error'}`);
  if (session.mode === 'postgres') return toast('Published');
  toast('Committed · live in about a minute', result.url);
}

/** A toast for any failure, listing field errors or import problems when the API sent them. */
export function report(e: unknown): void {
  if (e instanceof ApiError && Array.isArray(e.details)) return toastError(`${e.message}: ${e.details.join('; ')}`);
  if (e instanceof ApiError && e.status === 400 && e.details && typeof e.details === 'object') {
    const fields = Object.entries(e.details as Record<string, string>).map(([k, v]) => `${k}: ${v}`);
    return toastError(`${e.message} (${fields.join('; ')})`);
  }
  if (e instanceof ApiError || !(e instanceof Error)) return toastError(e instanceof Error ? e.message : String(e));
  // A fetch outside api() that never reached the server.
  if (/Failed to fetch|NetworkError|Load failed/.test(e.message)) return toastError(UNREACHABLE);
  // A bug in the admin itself: say what to do, keep the programmer's words for "Technical details".
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError) {
    return void toasts.push({
      id: ++lastToast,
      text: 'Something on this screen broke. Reload the page to carry on; changes you haven’t saved may be lost.',
      detail: e.stack ?? `${e.name}: ${e.message}`,
      error: true,
    });
  }
  toastError(e.message);
}

/** The request never reached the server: offline, or (locally) the dev server stopped. */
export const UNREACHABLE = import.meta.env?.DEV
  ? 'Can’t reach the site’s server. Check that `pnpm dev` is still running in your terminal, then try again.'
  : 'Can’t reach the server. Check your connection, then try again.';

/** A failure that came back without the admin's JSON error, e.g. a crashed route or a proxy's error page. */
function statusMessage(status: number): string {
  if (status === 404) return 'That isn’t here any more. Reload the page and try again.';
  if (status === 413) return 'That file is too large to upload.';
  if (status >= 500)
    return 'Something went wrong on the server. Try again; if it keeps happening, the server log says why.';
  return `The request failed (HTTP ${status}).`;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData | Blob } = {}, // a Blob is sent as the raw body
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  const data = res.headers.get('content-type')?.includes('application/json')
    ? await res.json().catch(() => null)
    : null;
  // The session ended: reloading lets the middleware send the page to the login screen.
  if (res.status === 401) location.reload();
  if (res.status === 503) session.outage = data?.error ?? 'The database is unreachable.';
  else if (res.ok) session.outage = '';
  if (!res.ok) throw new ApiError(res.status, data?.error ?? statusMessage(res.status), data?.details);
  return data as T;
}
