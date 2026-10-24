#!/usr/bin/env tsx
/**
 * pnpm setup:python — a Python 3.10+ in .venv with what the CV renderer and the Scholar sync need. Uses uv when it is
 * installed (it downloads a Python if none fits), else the newest python3.x on PATH. Safe to run again.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const VENV = path.join(ROOT, '.venv');
const PY = path.join(VENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const REQUIREMENTS = ['services/cv-render/requirements.txt', 'scripts/requirements.txt'];

function run(cmd: string, args: string[]): boolean {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' }).status === 0;
}

/** [major, minor] of a Python, or null when it does not run. */
function version(python: string): [number, number] | null {
  const r = spawnSync(python, ['-c', 'import sys; print(*sys.version_info[:2])'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const [major, minor] = r.stdout.trim().split(' ').map(Number);
  return [major, minor];
}
const fits = (v: [number, number] | null) => !!v && (v[0] > 3 || (v[0] === 3 && v[1] >= 10));
const has = (cmd: string) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

const requirements = REQUIREMENTS.flatMap((r) => ['-r', r]);
const uv = has('uv');
if (!fits(version(PY))) {
  if (uv) {
    if (!run('uv', ['venv', '--clear', '--python', '3.12', VENV])) fail('uv could not create .venv.');
  } else {
    const base = ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3'].find((p) => fits(version(p)));
    if (!base) {
      fail(
        'No Python 3.10 or newer found. Install uv (`brew install uv`, or see https://docs.astral.sh/uv/) or ' +
          'Python 3.12, then run `pnpm setup:python` again.',
      );
    }
    if (!run(base, ['-m', 'venv', '--clear', VENV])) fail(`${base} could not create .venv.`);
  }
}
const installed = uv
  ? run('uv', ['pip', 'install', '--python', PY, ...requirements])
  : run(PY, ['-m', 'pip', 'install', '--disable-pip-version-check', ...requirements]);
if (!installed) fail('Installing the Python packages failed; the output above says why.');
if (!run(PY, ['-c', 'import yaml, rendercv'])) fail('The packages installed, but RenderCV does not import.');
console.log(`\nPython is ready (${path.relative(ROOT, PY)}). CV PDFs and \`pnpm sync:scholar\` use it from now on.`);
if (!existsSync(path.join(ROOT, '.data'))) console.log('Start the site with `pnpm dev`.');
