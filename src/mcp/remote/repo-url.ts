const ALLOWED_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);

export interface RepoSpec {
  cloneUrl: string;
  host: string;
  slug: string;
}

export function parseRepoUrl(input: string): RepoSpec {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== 'https:') throw new Error('Only https:// repository URLs are supported.');
  if (url.username || url.password)
    throw new Error('Repository URLs must not contain credentials.');
  if (url.port) throw new Error('Repository URLs must not specify a port.');

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`Unsupported host "${host}". Allowed: ${[...ALLOWED_HOSTS].join(', ')}.`);
  }

  const slug = url.pathname
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean)
    .join('/');
  if (slug.split('/').length < 2) {
    throw new Error('Expected a repository URL of the form https://host/owner/repo.');
  }

  return { cloneUrl: `https://${host}/${slug}.git`, host, slug };
}

export function normalizeRef(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined;
  const trimmed = ref.trim();
  if (trimmed === '') return undefined;
  if (
    trimmed.length > 256 ||
    trimmed.startsWith('-') ||
    trimmed.includes('..') ||
    !/^[\w./-]+$/.test(trimmed)
  ) {
    throw new Error(
      `Invalid ref "${ref}". Use a branch or tag name (letters, digits, ., _, /, -).`,
    );
  }
  return trimmed;
}
