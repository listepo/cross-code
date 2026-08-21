/**
 * The one thing about `@cross-code/ns-lynx`'s bundle handling that only a
 * device can answer: that the path a `<LynxView src>` resolves to is a file
 * that exists in the app folder the {N} CLI synced — i.e. the plugin's
 * resolution agrees with the copy rule the plugin's own bundler helper adds.
 *
 * Importing the plugin here also proves its ESM `dist` loads in a NativeScript
 * runtime. Every pure rule (`~/…` vs `file:` vs `http(s)`, `toLynxJson`) is
 * unit-tested in packages/ns-lynx and deliberately not repeated on-device.
 */
import { describe, expect, it } from '@rstest/core';
import { File, knownFolders, path } from '@nativescript/core';
import { resolveBundleLocation } from '@cross-code/ns-lynx';

const APP_RELATIVE_SRC = '~/lynx/main.lynx.bundle';

describe('resolveBundleLocation', () => {
  it('points at a bundle that is actually on the device', () => {
    const location = resolveBundleLocation(APP_RELATIVE_SRC);

    expect(location.kind).toBe('app');

    const absolute = path.join(
      knownFolders.currentApp().path,
      (location as { relativePath: string }).relativePath,
    );

    expect(File.exists(absolute)).toBe(true);
  });
});
