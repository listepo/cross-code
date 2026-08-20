/**
 * Only reachable through `resolve.extensions`: nothing imports this file by
 * name, the suite imports `./support/platform-marker` and the bundler picks the
 * `.ios` or `.android` variant.
 */
export const PLATFORM_MARKER = 'android';
