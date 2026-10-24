import { existsSync } from 'node:fs';
import path from 'node:path';

/** What sets up the Python the CV renderer and the sync scripts need (scripts/setup-python.ts). */
export const SETUP_PYTHON = 'pnpm setup:python';

/**
 * The Python to run: PYTHON when set, else the project's .venv (made by `pnpm setup:python`), else `python3` from
 * PATH (CI and the render service install their packages there).
 */
export function pythonCommand(root = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.PYTHON) return env.PYTHON;
  const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return existsSync(venv) ? venv : 'python3';
}

/**
 * A Python failure that means the environment is not set up (no Python, a missing package, a Python too old for
 * RenderCV), in plain words with the fix; null for anything else, which the caller reports as it came.
 */
export function explainPythonFailure(stderr: string, what = 'The CV renderer'): string | null {
  const missing = /No module named '([^']+)'/.exec(stderr)?.[1];
  if (missing) {
    return `${what} is missing the Python package "${missing.split('.')[0]}". Run \`${SETUP_PYTHON}\` in the project folder, then try again.`;
  }
  if (/spawn \S*python\S* ENOENT|python3?: (command )?not found|No such file or directory.*python/i.test(stderr)) {
    return `${what} needs Python 3.10 or newer, and none was found. Run \`${SETUP_PYTHON}\` in the project folder, then try again.`;
  }
  // RenderCV uses 3.10+ syntax and typing: an older Python fails on import with one of these.
  if (
    /unsupported operand type\(s\) for \|: 'type'|requires a different Python|Requires-Python|match statement/i.test(
      stderr,
    )
  ) {
    return `${what} needs Python 3.10 or newer. Run \`${SETUP_PYTHON}\` to set one up for this project, then try again.`;
  }
  return null;
}
