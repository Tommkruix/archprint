import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { RepoSpec } from './repo-url.js';

export interface CloneOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

export async function withClonedRepo<T>(
  spec: RepoSpec,
  ref: string | undefined,
  options: CloneOptions,
  use: (dir: string) => T | Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'archprint-remote-'));
  try {
    await cloneShallow(spec.cloneUrl, ref, dir, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    await assertSizeWithin(dir, options.maxBytes ?? DEFAULT_MAX_BYTES);
    return await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function cloneShallow(
  cloneUrl: string,
  ref: string | undefined,
  dir: string,
  timeoutMs: number,
): Promise<void> {
  const args = ['-c', 'credential.helper=', 'clone', '--depth', '1', '--single-branch'];
  if (ref) args.push('--branch', ref);
  args.push('--', cloneUrl, dir);

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      timeout: timeoutMs,
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString();
    });
    child.on('error', (error) => reject(new Error(`Could not run git: ${error.message}`)));
    child.on('close', (code, signal) => {
      if (signal) return reject(new Error(`git clone timed out after ${timeoutMs}ms.`));
      if (code === 0) return resolve();
      const detail = stderr.replace(/\S*archprint-remote-\S*/g, '<repo>').trim() || `exit ${code}`;
      reject(new Error(`git clone failed for ${cloneUrl}${ref ? ` (ref ${ref})` : ''}: ${detail}`));
    });
  });
}

async function assertSizeWithin(dir: string, maxBytes: number): Promise<void> {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        total += (await stat(full)).size;
        if (total > maxBytes) {
          throw new Error(`Repository exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
        }
      }
    }
  }
}
