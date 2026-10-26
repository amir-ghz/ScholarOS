import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * PrimeTek moved @primeuix/themes 3+, primeicons 8+ and their newest @primeuix helpers to a commercial licence. The
 * admin pins the last MIT releases; this fails when an upgrade (direct or transitive) brings in anything else.
 */
const ROOTS = ['primevue', '@primeuix/themes', 'primeicons', 'tailwindcss-primeui', 'chart.js', 'jsvectormap'];
const TRACK = /^(@primeuix\/|@primevue\/|primevue$|primeicons$)/;

/** `name`'s package.json as Node would find it from `from`: up through node_modules folders (pnpm links followed). */
function pkgJson(from: string, name: string): { file: string; json: Record<string, unknown> } | null {
  for (let dir = path.dirname(realpathSync(from)); ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules', name, 'package.json');
    if (existsSync(file)) {
      const real = realpathSync(file);
      return { file: real, json: JSON.parse(readFileSync(real, 'utf8')) as Record<string, unknown> };
    }
    if (path.dirname(dir) === dir) return null;
  }
}

test('the admin UI packages and their PrimeTek dependencies are MIT', () => {
  const seen = new Map<string, string>();
  const queue = ROOTS.map((name) => ({ name, from: path.join(process.cwd(), 'package.json') }));
  while (queue.length) {
    const { name, from } = queue.shift()!;
    const pkg = pkgJson(from, name);
    if (!pkg) continue;
    const id = `${name}@${pkg.json.version}`;
    if (seen.has(id)) continue;
    seen.set(id, String(pkg.json.license));
    for (const dep of Object.keys((pkg.json.dependencies as Record<string, string>) ?? {})) {
      if (TRACK.test(dep)) queue.push({ name: dep, from: pkg.file });
    }
  }
  const notMit = [...seen].filter(([, license]) => license !== 'MIT');
  assert.deepEqual(notMit, [], `not MIT: ${notMit.map(([id, l]) => `${id} (${l})`).join(', ')}`);
  assert.ok(seen.size >= ROOTS.length);
});
