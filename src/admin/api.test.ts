import test, { before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, UNREACHABLE, committed, dismissToast, report, session, splitError, toast, toasts } from './api';

// Toasts expire on a timer; fake timers keep them from holding the test process open.
before(() => mock.timers.enable({ apis: ['setTimeout'] }));
beforeEach(() => {
  toasts.splice(0);
});

test('git mode: commit toast with the commit link', () => {
  session.mode = 'git';
  committed({ url: 'https://github.com/o/r/commit/c' });
  assert.equal(toasts[0].text, 'Committed · live in about a minute');
  assert.equal(toasts[0].href, 'https://github.com/o/r/commit/c');
});

test('postgres mode: "Published"; a failed purge offers Retry refresh', () => {
  session.mode = 'postgres';
  committed({});
  assert.equal(toasts[0].text, 'Published');
  committed({ warning: 'cache-purge-failed', tags: ['cfg:site'] });
  assert.match(toasts[1].text, /could not be refreshed/);
  assert.equal(toasts[1].action?.label, 'Retry refresh');
  assert.equal(toasts[1].error, true);
});

test('errors, action toasts and link toasts stay until dismissed; plain notices time out', () => {
  report(new Error('boom'));
  toast('Hidden', undefined, { label: 'Undo', run: () => {} });
  toast('Committed', 'https://github.com/o/r/commit/c');
  toast('Saved');
  mock.timers.tick(60_000);
  assert.deepEqual(
    toasts.map((t) => [t.text, !!t.error]),
    [
      ['boom', true],
      ['Hidden', false],
      ['Committed', false],
    ],
  );
  dismissToast(toasts[0].id);
  assert.equal(toasts.length, 2);
});

test('a PDF failure after a save says the save stands', () => {
  session.mode = 'postgres';
  committed({ warning: 'pdf-failed', detail: 'quota exceeded' });
  assert.equal(toasts[0].text, 'Saved; PDF generation failed: quota exceeded');
});

test('a traceback keeps a short lead and moves the rest behind Technical details', () => {
  const raw = `CV renderer failed (exit 1):  File "services/cv-render/cli.py", line 6, in <module>
    import cvrender
ModuleNotFoundError: No module named 'yaml'`;
  assert.deepEqual(splitError(raw), { text: 'CV renderer failed (exit 1).', detail: raw });
  assert.deepEqual(splitError('Saved.'), { text: 'Saved.' });
  const long = `${'The renderer refused the theme because a field is wrong. '.repeat(3)}${'x'.repeat(200)}`;
  const { text, detail } = splitError(long);
  assert.ok(text.length <= 221 && text.endsWith('.'));
  assert.equal(detail, long.trim());
});

test('report: a bug says to reload, a dropped connection says how to reach the server', () => {
  report(new TypeError("Cannot read properties of undefined (reading 'x')"));
  assert.match(toasts[0].text, /Reload the page/);
  assert.match(toasts[0].detail!, /reading 'x'/);
  report(new TypeError('Failed to fetch'));
  assert.equal(toasts[1].text, UNREACHABLE);
  report(new ApiError(502, 'The CV renderer is missing the Python package "yaml". Run `pnpm setup:python`.'));
  assert.match(toasts[2].text, /pnpm setup:python/);
  assert.equal(toasts[2].detail, undefined);
});
