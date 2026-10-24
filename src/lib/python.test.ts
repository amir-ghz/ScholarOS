import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { explainPythonFailure, pythonCommand } from './python';

test('pythonCommand prefers PYTHON, then the project .venv, then python3', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'py-'));
  assert.equal(pythonCommand(root, {}), 'python3');
  const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
  mkdirSync(venv, { recursive: true });
  writeFileSync(path.join(venv, process.platform === 'win32' ? 'python.exe' : 'python'), '');
  assert.match(pythonCommand(root, {}), /\.venv/);
  assert.equal(pythonCommand(root, { PYTHON: '/opt/py' }), '/opt/py');
});

test('explainPythonFailure names the missing package and the fix', () => {
  const trace = `Traceback (most recent call last):
  File "services/cv-render/cvrender.py", line 16, in <module>
    import yaml
ModuleNotFoundError: No module named 'yaml'`;
  const plain = explainPythonFailure(trace);
  assert.match(plain!, /missing the Python package "yaml"/);
  assert.match(plain!, /pnpm setup:python/);
  assert.match(explainPythonFailure("No module named 'rendercv.cli'")!, /"rendercv"/);
});

test('explainPythonFailure recognizes a missing or too-old Python', () => {
  assert.match(explainPythonFailure('spawn python3 ENOENT')!, /none was found/);
  assert.match(explainPythonFailure("TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'")!, /3\.10/);
});

test('explainPythonFailure leaves other failures alone', () => {
  assert.equal(explainPythonFailure('ValueError: bad date'), null);
});
