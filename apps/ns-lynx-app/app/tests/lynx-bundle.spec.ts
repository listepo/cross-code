/**
 * `@cross-code/ns-lynx`'s bundle handling, exercised on the device against the
 * real app folder. The pure rules are unit-tested in the plugin; what this adds
 * is that the path a `<LynxView src>` resolves to is a file that exists in the
 * bundle the {N} CLI synced.
 */
import { describe, expect, it } from '@rstest/core';
import { File, knownFolders, path } from '@nativescript/core';
import {
  LynxError,
  resolveBundleLocation,
  toLynxJson,
} from '@cross-code/ns-lynx';

const APP_RELATIVE_SRC = '~/lynx/main.lynx.bundle';

describe('resolveBundleLocation', () => {
  it('reads the app-relative form the host page uses', () => {
    expect(resolveBundleLocation(APP_RELATIVE_SRC)).toEqual({
      kind: 'app',
      relativePath: 'lynx/main.lynx.bundle',
    });
  });

  it('points at a bundle that is actually on the device', () => {
    const location = resolveBundleLocation(APP_RELATIVE_SRC);

    expect(location.kind).toBe('app');

    const absolute = path.join(
      knownFolders.currentApp().path,
      (location as { relativePath: string }).relativePath,
    );

    expect(File.exists(absolute)).toBe(true);
  });

  it('treats an absolute device path as a file', () => {
    const documents = knownFolders.documents().path;

    expect(resolveBundleLocation(documents)).toEqual({
      kind: 'file',
      path: documents,
    });
  });

  it('treats an http(s) source as a download', () => {
    expect(resolveBundleLocation('https://example.com/main.lynx.bundle')).toEqual({
      kind: 'remote',
      url: 'https://example.com/main.lynx.bundle',
    });
  });

  it('rejects an empty source with a LynxError', () => {
    expect(() => resolveBundleLocation('   ')).toThrow(LynxError);
  });
});

describe('toLynxJson', () => {
  it('serializes the objects a page reads through useInitData', () => {
    expect(toLynxJson({ greeting: 'hi' })).toBe('{"greeting":"hi"}');
  });

  it('passes a string through as already-encoded JSON', () => {
    expect(toLynxJson(' {"a":1} ')).toBe('{"a":1}');
  });

  it('sends nothing rather than "null" when there is no data', () => {
    expect(toLynxJson(undefined)).toBeUndefined();
    expect(toLynxJson(null)).toBeUndefined();
    expect(toLynxJson('')).toBeUndefined();
  });
});
