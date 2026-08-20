import { describe, expect, it } from 'vitest';
import { LynxError, resolveBundleLocation, toLynxJson } from './bundle.js';

describe('resolveBundleLocation', () => {
  it('treats app-relative and bare names as app assets', () => {
    expect(resolveBundleLocation('~/lynx/main.lynx.bundle')).toEqual({
      kind: 'app',
      relativePath: 'lynx/main.lynx.bundle',
    });
    expect(resolveBundleLocation('main.lynx.bundle')).toEqual({
      kind: 'app',
      relativePath: 'main.lynx.bundle',
    });
  });

  it('keeps absolute device paths and decodes file: URLs', () => {
    expect(resolveBundleLocation('/var/mobile/main.lynx.bundle')).toEqual({
      kind: 'file',
      path: '/var/mobile/main.lynx.bundle',
    });
    expect(resolveBundleLocation('file:///var/my%20app/main.lynx.bundle')).toEqual({
      kind: 'file',
      path: '/var/my app/main.lynx.bundle',
    });
  });

  it('defers http(s) sources to a download', () => {
    expect(resolveBundleLocation('https://cdn.example/main.lynx.bundle')).toEqual({
      kind: 'remote',
      url: 'https://cdn.example/main.lynx.bundle',
    });
    expect(resolveBundleLocation('HTTP://cdn.example/a.bundle').kind).toBe('remote');
  });

  it('rejects an empty source', () => {
    expect(() => resolveBundleLocation('   ')).toThrow(LynxError);
  });
});

describe('toLynxJson', () => {
  it('serializes objects and passes JSON strings through', () => {
    expect(toLynxJson({ greeting: 'hi' })).toBe('{"greeting":"hi"}');
    expect(toLynxJson('{"greeting":"hi"}')).toBe('{"greeting":"hi"}');
  });

  it('drops empty values so Lynx keeps its own defaults', () => {
    expect(toLynxJson(undefined)).toBeUndefined();
    expect(toLynxJson(null)).toBeUndefined();
    expect(toLynxJson('  ')).toBeUndefined();
  });
});
