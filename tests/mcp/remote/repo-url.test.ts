import { describe, expect, it } from 'vitest';
import { normalizeRef, parseRepoUrl } from '../../../src/mcp/remote/repo-url.js';

describe('parseRepoUrl', () => {
  it('normalizes a github URL to a clone URL, host, and slug', () => {
    expect(parseRepoUrl('https://github.com/facebook/react')).toEqual({
      cloneUrl: 'https://github.com/facebook/react.git',
      host: 'github.com',
      slug: 'facebook/react',
    });
  });

  it('strips a trailing .git and slash, including a combined .git/', () => {
    expect(parseRepoUrl('https://github.com/facebook/react.git').slug).toBe('facebook/react');
    expect(parseRepoUrl('https://github.com/facebook/react/').slug).toBe('facebook/react');
    expect(parseRepoUrl('https://github.com/facebook/react.git/')).toEqual({
      cloneUrl: 'https://github.com/facebook/react.git',
      host: 'github.com',
      slug: 'facebook/react',
    });
    expect(parseRepoUrl('https://github.com/facebook/react.GIT').slug).toBe('facebook/react');
  });

  it('keeps nested gitlab groups in the slug', () => {
    expect(parseRepoUrl('https://gitlab.com/group/subgroup/repo').cloneUrl).toBe(
      'https://gitlab.com/group/subgroup/repo.git',
    );
  });

  it('accepts bitbucket', () => {
    expect(parseRepoUrl('https://bitbucket.org/team/repo').host).toBe('bitbucket.org');
  });

  it('rejects a non-https scheme', () => {
    expect(() => parseRepoUrl('http://github.com/a/b')).toThrow(/https/);
    expect(() => parseRepoUrl('git@github.com:a/b.git')).toThrow(/valid URL|https/);
  });

  it('rejects embedded credentials, including the host@host trick', () => {
    expect(() => parseRepoUrl('https://user:pass@github.com/a/b')).toThrow(/credentials/);
    expect(() => parseRepoUrl('https://github.com@evil.com/a/b')).toThrow(/credentials/);
  });

  it('rejects an explicit port', () => {
    expect(() => parseRepoUrl('https://github.com:8443/a/b')).toThrow(/port/);
  });

  it('rejects a host that is not on the allowlist', () => {
    expect(() => parseRepoUrl('https://evil.com/a/b')).toThrow(/Unsupported host/);
    expect(() => parseRepoUrl('https://github.com.evil.com/a/b')).toThrow(/Unsupported host/);
  });

  it('rejects a URL without an owner and repo', () => {
    expect(() => parseRepoUrl('https://github.com/facebook')).toThrow(/owner\/repo/);
  });

  it('rejects a value that is not a URL', () => {
    expect(() => parseRepoUrl('not a url')).toThrow(/valid URL/);
  });
});

describe('normalizeRef', () => {
  it('passes through a branch or tag name', () => {
    expect(normalizeRef('main')).toBe('main');
    expect(normalizeRef('release/1.2')).toBe('release/1.2');
    expect(normalizeRef('v2.0.0')).toBe('v2.0.0');
  });

  it('treats undefined and blank as no ref', () => {
    expect(normalizeRef(undefined)).toBeUndefined();
    expect(normalizeRef('   ')).toBeUndefined();
  });

  it('rejects a ref that could be read as a flag or path traversal', () => {
    expect(() => normalizeRef('--upload-pack')).toThrow(/Invalid ref/);
    expect(() => normalizeRef('../evil')).toThrow(/Invalid ref/);
    expect(() => normalizeRef('a b')).toThrow(/Invalid ref/);
  });

  it('rejects an over-long ref', () => {
    expect(() => normalizeRef('a'.repeat(257))).toThrow(/Invalid ref/);
  });
});
