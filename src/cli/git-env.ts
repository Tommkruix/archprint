import { execFileSync } from 'node:child_process';

let repositoryLocalVariables: readonly string[] | undefined;

const localVariables = (): readonly string[] =>
  (repositoryLocalVariables ??= execFileSync('git', ['rev-parse', '--local-env-vars'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean));

/** The current environment without the variables that bind git to one repository, such as a hook's GIT_DIR. */
export function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of localVariables()) delete env[name];
  return env;
}
