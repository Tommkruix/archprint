import { builtinModules } from 'node:module';
import { describe, expect, it } from 'vitest';
import { hasLeadingDirective } from '../../src/scanner/directives.js';
import { packageName } from '../../src/scanner/package-name.js';

describe('hasLeadingDirective', () => {
  it('finds the directive after a BOM or a shebang line, as JavaScript does', () => {
    expect(hasLeadingDirective('﻿"use client";\n', 'use client')).toBe(true);
    expect(hasLeadingDirective('#!/usr/bin/env node\n"use client";\n', 'use client')).toBe(true);
    expect(hasLeadingDirective('#!/usr/bin/env node', 'use client')).toBe(false);
  });

  it('needs the directive itself, not another one first', () => {
    expect(hasLeadingDirective('"use strict";\n"use client";\n', 'use client')).toBe(false);
    expect(hasLeadingDirective('"use client";\n', 'use server')).toBe(false);
  });
});

describe('packageName', () => {
  const builtins = new Set(builtinModules);
  const aliases = ['@', '~'];

  it('names the package of a bare or scoped specifier', () => {
    expect(packageName('lodash/fp', aliases, builtins)).toBe('lodash');
    expect(packageName('@scope/pkg/sub', aliases, builtins)).toBe('@scope/pkg');
  });

  it('skips builtins, aliases, relative paths, subpath imports and scheme specifiers', () => {
    for (const specifier of [
      'fs',
      'fs/promises',
      'node:path',
      '@/lib/db',
      '~/x',
      './a',
      '#internal/db',
      'bun:test',
      'virtual:routes',
    ]) {
      expect(packageName(specifier, aliases, builtins)).toBeNull();
    }
  });
});
