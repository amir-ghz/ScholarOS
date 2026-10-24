#!/usr/bin/env tsx
/** `tsx scripts/python.ts <script.py> [args]`: runs a Python script with the project's Python (src/lib/python.ts). */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { SETUP_PYTHON, explainPythonFailure, pythonCommand } from '../src/lib/python';

const ROOT = path.resolve(import.meta.dirname, '..');
const python = pythonCommand(ROOT);
const r = spawnSync(python, process.argv.slice(2), {
  cwd: ROOT,
  stdio: ['inherit', 'inherit', 'pipe'],
  encoding: 'utf8',
});
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0) {
  const plain = explainPythonFailure(r.error?.message ?? r.stderr ?? '', 'This script');
  if (plain) console.error(`\n${plain}`);
  else if (r.error) console.error(`\nCould not run ${python}: ${r.error.message}. Try \`${SETUP_PYTHON}\`.`);
}
process.exit(r.status ?? 1);
