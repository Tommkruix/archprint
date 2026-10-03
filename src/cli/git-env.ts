import { execFileSync } from 'node:child_process';

let repositoryLocalVariables: readonly string[] | undefined;

const localVariables = (): readonly string[] =>
  (repositoryLocalVariables ??= execFileSync('git', ['rev-parse', '--local-env-vars'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean));

export function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of localVariables()) delete env[name];
  return env;
}
