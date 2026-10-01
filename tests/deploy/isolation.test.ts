import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const deployDir = path.join(repoRoot, 'deploy');

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop()!, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'archprint-deploy-'));
  temps.push(dir);
  return dir;
}

function stubGcloud(dir: string, account: string): void {
  const bin = path.join(dir, 'gcloud');
  writeFileSync(
    bin,
    `#!/bin/sh\nif [ "$1" = "auth" ] && [ "$2" = "list" ]; then echo "${account}"; exit 0; fi\nexit 0\n`,
  );
  chmodSync(bin, 0o755);
}

function runPreflight(options: { signedInAs?: string; conf?: string }): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const stubDir = scratch();
  if (options.signedInAs !== undefined) stubGcloud(stubDir, options.signedInAs);
  const result = spawnSync('sh', [path.join(deployDir, 'preflight.sh')], {
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      ARCHPRINT_CLOUD_CONF: options.conf ?? path.join(scratch(), 'missing.conf'),
      ARCHPRINT_CLOUDSDK_CONFIG: path.join(scratch(), 'cloudsdk'),
    },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function confFile(contents: string): string {
  const file = path.join(scratch(), 'cloud.conf');
  writeFileSync(file, contents);
  return file;
}

describe('deploy credential isolation', () => {
  it('refuses before acting when signed in as a different account', () => {
    const conf = confFile('PROJECT=p\nREGION=r\nACCOUNT=expected@example.com\n');
    const run = runPreflight({ signedInAs: 'someone@other-org.example', conf });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/Refusing/);
    expect(run.stdout).not.toMatch(/ready as/);
  });

  it('proceeds only when the signed-in account matches the config', () => {
    const conf = confFile('PROJECT=p\nREGION=r\nACCOUNT=expected@example.com\n');
    const run = runPreflight({ signedInAs: 'expected@example.com', conf });

    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/ready as expected@example\.com/);
  });

  it('refuses when no account is signed in', () => {
    const conf = confFile('PROJECT=p\nREGION=r\nACCOUNT=expected@example.com\n');
    const run = runPreflight({ signedInAs: '', conf });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/no account is signed in/);
  });

  it('refuses when the config is missing or a required key is empty', () => {
    expect(runPreflight({ signedInAs: 'expected@example.com' }).stderr).toMatch(/no config at/);

    const empty = confFile('PROJECT=p\nREGION=r\nACCOUNT=\n');
    const run = runPreflight({ signedInAs: 'expected@example.com', conf: empty });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/ACCOUNT is empty/);
  });

  for (const defaultExists of [true, false]) {
    it(`refuses a differently-cased alias of the default (default ${defaultExists ? 'present' : 'absent'})`, () => {
      const home = scratch();
      mkdirSync(path.join(home, '.config', defaultExists ? 'gcloud' : 'other'), {
        recursive: true,
      });

      const stubDir = scratch();
      const marker = path.join(scratch(), 'gcloud-ran');
      writeFileSync(path.join(stubDir, 'gcloud'), `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
      chmodSync(path.join(stubDir, 'gcloud'), 0o755);

      const run = spawnSync('sh', [path.join(deployDir, 'gcloud'), 'version'], {
        env: {
          ...process.env,
          HOME: home,
          PATH: `${stubDir}:${process.env.PATH ?? ''}`,
          ARCHPRINT_CLOUDSDK_CONFIG: `${home}/.config/GCLOUD`,
        },
        encoding: 'utf8',
      });

      expect(run.status).not.toBe(0);
      expect(run.stderr).toMatch(/refusing to use the machine default/);
      expect(existsSync(marker), 'gcloud must never be reached').toBe(false);
      if (!defaultExists) {
        expect(existsSync(path.join(home, '.config', 'GCLOUD')), 'nothing may be created').toBe(
          false,
        );
      }
    });
  }

  it('never calls gcloud directly outside the wrapper', () => {
    const mentions = /\bgcloud\b/;
    const throughWrapper = /\$GCLOUD|deploy\/gcloud|DEPLOY_DIR"?\/gcloud/;
    for (const name of readdirSync(deployDir)) {
      if (name === 'gcloud') continue;
      const lines = readFileSync(path.join(deployDir, name), 'utf8').split('\n');
      const offending = lines.filter(
        (line) =>
          !line.trimStart().startsWith('#') && mentions.test(line) && !throughWrapper.test(line),
      );
      expect(offending, `${name} reaches gcloud outside the wrapper`).toEqual([]);
    }
  });

  it('the wrapper exports its own credential directory', () => {
    const wrapper = readFileSync(path.join(deployDir, 'gcloud'), 'utf8');
    expect(wrapper).toMatch(/CLOUDSDK_CONFIG/);
    expect(wrapper).toMatch(/export CLOUDSDK_CONFIG/);
  });

  it('runs gcloud against the isolated directory, not the machine default', () => {
    const stubDir = scratch();
    const bin = path.join(stubDir, 'gcloud');
    writeFileSync(bin, '#!/bin/sh\nprintf "%s" "$CLOUDSDK_CONFIG"\n');
    chmodSync(bin, 0o755);
    const isolated = path.join(scratch(), 'cloudsdk');

    const run = spawnSync('sh', [path.join(deployDir, 'gcloud'), 'version'], {
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH ?? ''}`,
        ARCHPRINT_CLOUDSDK_CONFIG: isolated,
      },
      encoding: 'utf8',
    });

    expect(run.stdout).toBe(isolated);
  });

  it('pins Application Default Credentials inside the isolated directory', () => {
    const stubDir = scratch();
    const bin = path.join(stubDir, 'gcloud');
    writeFileSync(bin, '#!/bin/sh\nprintf "%s" "$GOOGLE_APPLICATION_CREDENTIALS"\n');
    chmodSync(bin, 0o755);
    const isolated = path.join(scratch(), 'cloudsdk');

    const run = spawnSync('sh', [path.join(deployDir, 'gcloud'), 'version'], {
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH ?? ''}`,
        ARCHPRINT_CLOUDSDK_CONFIG: isolated,
        GOOGLE_APPLICATION_CREDENTIALS: path.join(
          process.env.HOME ?? '',
          '.config',
          'gcloud',
          'application_default_credentials.json',
        ),
      },
      encoding: 'utf8',
    });

    expect(run.stdout).toBe(path.join(isolated, 'application_default_credentials.json'));
  });

  const disguises = (home: string): [string, string][] => [
    ['exact', `${home}/.config/gcloud`],
    ['trailing slash', `${home}/.config/gcloud/`],
    ['dot segment', `${home}/.config/./gcloud`],
    ['a directory inside it', `${home}/.config/gcloud/sub`],
    ['dot dot through a missing sibling', `${home}/.config/gcloud-archprint/../gcloud`],
    ['doubled slashes', `${home}//.config//gcloud`],
  ];

  for (const [label] of disguises('')) {
    it(`refuses the machine default configuration, however it is spelled (${label})`, () => {
      const home = scratch();
      mkdirSync(path.join(home, '.config', 'gcloud'), { recursive: true });
      const requested = disguises(home).find(([name]) => name === label)![1];

      const stubDir = scratch();
      const marker = path.join(scratch(), 'gcloud-ran');
      writeFileSync(path.join(stubDir, 'gcloud'), `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
      chmodSync(path.join(stubDir, 'gcloud'), 0o755);

      const run = spawnSync('sh', [path.join(deployDir, 'gcloud'), 'version'], {
        env: {
          ...process.env,
          HOME: home,
          PATH: `${stubDir}:${process.env.PATH ?? ''}`,
          ARCHPRINT_CLOUDSDK_CONFIG: requested,
        },
        encoding: 'utf8',
      });

      expect(run.status).not.toBe(0);
      expect(run.stderr).toMatch(/refusing to use the machine default/);
      expect(existsSync(marker), 'gcloud must never be reached').toBe(false);
    });
  }

  it('ignores gcloud overrides inherited from the environment', () => {
    const stubDir = scratch();
    writeFileSync(
      path.join(stubDir, 'gcloud'),
      '#!/bin/sh\nprintf "%s|%s|%s" "${CLOUDSDK_AUTH_ACCESS_TOKEN:-}" "${CLOUDSDK_CORE_ACCOUNT:-}" "${CLOUDSDK_CORE_PROJECT:-}"\n',
    );
    chmodSync(path.join(stubDir, 'gcloud'), 0o755);

    const run = spawnSync('sh', [path.join(deployDir, 'gcloud'), 'version'], {
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH ?? ''}`,
        ARCHPRINT_CLOUDSDK_CONFIG: path.join(scratch(), 'cloudsdk'),
        CLOUDSDK_AUTH_ACCESS_TOKEN: 'token-from-another-account',
        CLOUDSDK_CORE_ACCOUNT: 'someone@other-org.example',
        CLOUDSDK_CORE_PROJECT: 'another-project',
      },
      encoding: 'utf8',
    });

    expect(run.stdout).toBe('||');
  });

  it('uploads only the Dockerfile to Cloud Build', () => {
    const rules = readFileSync(path.join(deployDir, '.gcloudignore'), 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(rules[0]).toBe('*');
    expect(rules.filter((rule) => rule.startsWith('!'))).toEqual(['!Dockerfile']);
  });

  it('refuses a cloud command when the account guard has not run', () => {
    const probe = path.join(deployDir, '.probe-unguarded.sh');
    writeFileSync(probe, '#!/bin/sh\nset -eu\n. "$(dirname -- "$0")/lib.sh"\ngc version\n');
    try {
      const stubDir = scratch();
      const marker = path.join(scratch(), 'gcloud-ran');
      writeFileSync(path.join(stubDir, 'gcloud'), `#!/bin/sh\ntouch "${marker}"\n`);
      chmodSync(path.join(stubDir, 'gcloud'), 0o755);

      const run = spawnSync('sh', [probe], {
        env: {
          ...process.env,
          PATH: `${stubDir}:${process.env.PATH ?? ''}`,
          ARCHPRINT_CLOUD_CONF: confFile('PROJECT=p\nREGION=r\nACCOUNT=a@example.com\n'),
          ARCHPRINT_CLOUDSDK_CONFIG: path.join(scratch(), 'cloudsdk'),
        },
        encoding: 'utf8',
      });

      expect(run.status).not.toBe(0);
      expect(run.stderr).toMatch(/before the account guard ran/);
      expect(existsSync(marker), 'gcloud must never be reached').toBe(false);
    } finally {
      rmSync(probe, { force: true });
    }
  });

  for (const [signedInAs, deletes] of [
    ['a@example.com', true],
    ['someone@other-org.example', false],
  ] as const) {
    it(`teardown ${deletes ? 'deletes only the configured service' : 'refuses under another account'}`, () => {
      const stubDir = scratch();
      const calls = path.join(scratch(), 'calls');
      writeFileSync(
        path.join(stubDir, 'gcloud'),
        `#!/bin/sh\nif [ "$1" = "auth" ] && [ "$2" = "list" ]; then echo "${signedInAs}"; exit 0; fi\necho "$*" >> "${calls}"\n`,
      );
      chmodSync(path.join(stubDir, 'gcloud'), 0o755);

      const run = spawnSync('sh', [path.join(deployDir, 'teardown.sh')], {
        env: {
          ...process.env,
          PATH: `${stubDir}:${process.env.PATH ?? ''}`,
          ARCHPRINT_CLOUD_CONF: confFile(
            'PROJECT=p\nREGION=r\nACCOUNT=a@example.com\nSERVICE=svc\n',
          ),
          ARCHPRINT_CLOUDSDK_CONFIG: path.join(scratch(), 'cloudsdk'),
        },
        encoding: 'utf8',
      });

      if (deletes) {
        expect(run.status).toBe(0);
        expect(readFileSync(calls, 'utf8').trim()).toBe(
          'run services delete svc --region r --project=p',
        );
      } else {
        expect(run.status).not.toBe(0);
        expect(existsSync(calls), 'nothing may be deleted').toBe(false);
      }
    });
  }

  it('keeps the real config out of version control', () => {
    const ignores = (file: string): boolean =>
      spawnSync('git', ['check-ignore', file], { cwd: repoRoot, encoding: 'utf8' }).status === 0;

    expect(ignores('deploy/cloud.conf'), 'the real config must be gitignored').toBe(true);
    expect(ignores('deploy/cloud.conf.bak'), 'config copies must be gitignored too').toBe(true);
    expect(ignores('deploy/cloud.conf.example'), 'the example must stay tracked').toBe(false);

    const example = readFileSync(path.join(deployDir, 'cloud.conf.example'), 'utf8');
    const addresses = example.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) expect(address).toMatch(/@example\.com$/);
  });
});
