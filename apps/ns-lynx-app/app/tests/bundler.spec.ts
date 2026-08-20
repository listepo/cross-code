/**
 * What `@cross-code/ns-rspack` produced, checked on the device that has to run
 * it. These are the parts of the bundler contract that only the {N} runtime can
 * confirm: the compile-time defines, the module resolution rules, and the files
 * the copy rules put next to the bundle.
 *
 * Rstest discovers this file in Node; @cross-code/ns-rstest executes it inside
 * a NativeScript Worker on the selected device.
 */
import { describe, expect, it } from '@rstest/core';
import { Device, File, knownFolders, path } from '@nativescript/core';

import markup from './support/fixture.xml';
import { PLATFORM_MARKER } from './support/platform-marker';
import { ALIAS_TARGET } from '~/tests/support/alias-target';

const isIOS = Device.os === 'iOS';

describe('compile-time defines', () => {
  it('marks the platform the bundle was built for', () => {
    // compared against the runtime's own answer rather than each other:
    // both sides of a define comparison would be substituted at build time
    expect(__IOS__).toBe(isIOS);
    expect(__ANDROID__).toBe(!isIOS);
    expect(__APPLE__).toBe(isIOS);
  });

  it('keeps the legacy global.isIOS / global.isAndroid flags in step', () => {
    expect(global.isIOS).toBe(isIOS);
    expect(global.isAndroid).toBe(!isIOS);
  });

  it('builds a development bundle for a test run', () => {
    expect(__DEV__).toBe(true);
    expect(__NS_WEBPACK__).toBe(true);
  });

  it('tells @nativescript/core which CSS parser to use', () => {
    expect(__CSS_PARSER__).toBe('css-tree');
  });

  it('emits ESM for a {N} 9 runtime and leaves import.meta to it', () => {
    expect(__COMMONJS__).toBe(false);
    // rspack would otherwise rewrite import.meta into a fileURLToPath() shim
    // importing node:url and node:path, which have no named exports on device
    expect(import.meta.url).toMatch(/^file:\/\/.*\.mjs$/);
  });
});

describe('module resolution', () => {
  it('resolves the ~ alias to the app folder', () => {
    expect(ALIAS_TARGET).toBe('resolved through the ~ alias');
  });

  it('picks the platform variant of an extensionless import', () => {
    // there is no platform-marker.ts — only .ios.ts and .android.ts
    expect(PLATFORM_MARKER).toBe(isIOS ? 'ios' : 'android');
  });
});

describe('loaders', () => {
  it('exports .xml markup as a string', () => {
    expect(typeof markup).toBe('string');
    expect(markup).toContain('xml-namespace-loader');
  });
});

describe('copy rules', () => {
  it('puts the Lynx bundle next to the app bundle', () => {
    // rspack.config.ts copies lynx/dist/main.lynx.bundle in; <LynxView src>
    // reads it from there at runtime
    const bundlePath = path.join(
      knownFolders.currentApp().path,
      'lynx',
      'main.lynx.bundle',
    );

    expect(File.exists(bundlePath)).toBe(true);
    expect(File.fromPath(bundlePath).size).toBeGreaterThan(0);
  });
});
