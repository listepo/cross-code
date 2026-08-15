import { isAndroid } from '@nativescript/core';
import { LynxView as AndroidLynxView } from './lynx-view-android.js';
import { LynxView as IosLynxView } from './lynx-view-ios.js';
import type { LynxViewBase } from './lynx-view-common.js';

/**
 * The `<LynxView>` element. Both platform classes are defined at import time —
 * neither touches a native global until a view is actually created — so the
 * choice is a plain runtime branch, matching the other plugins in this repo.
 */
export const LynxView: typeof LynxViewBase = isAndroid
  ? (AndroidLynxView as unknown as typeof LynxViewBase)
  : (IosLynxView as unknown as typeof LynxViewBase);

export type LynxView = LynxViewBase;
