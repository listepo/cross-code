import { Screen, Utils } from '@nativescript/core';
import { LynxError } from './bundle.js';
import { LynxViewBase, type LynxData } from './lynx-view-common.js';
import type {
  LynxGlobalIOS,
  LynxTemplateDataIOS,
  LynxViewIOS,
} from './native-api.js';

/** `LynxViewSizeMode.exact` — the host view owns the size. */
const SIZE_MODE_EXACT = 1;

let environmentReady = false;

function lynx(): Required<LynxGlobalIOS> {
  const scope = globalThis as unknown as LynxGlobalIOS;
  if (!scope.LynxView || !scope.LynxEnv || !scope.LynxLoadMeta || !scope.LynxTemplateData) {
    throw new LynxError(
      'The Lynx iOS SDK is missing. Add @cross-code/ns-lynx to the app so its Podfile contributes the Lynx and PrimJS pods, then re-run pod install.',
    );
  }
  return scope as Required<LynxGlobalIOS>;
}

/** `LynxEnv` is global and must be initialized before any other Lynx call. */
function ensureEnvironment(): void {
  if (environmentReady) return;
  lynx().LynxEnv.sharedInstance();
  environmentReady = true;
}

function templateData(json: string | undefined): LynxTemplateDataIOS | undefined {
  return json === undefined
    ? undefined
    : lynx().LynxTemplateData.alloc().initWithJson(json);
}

export class LynxView extends LynxViewBase {
  declare nativeViewProtected: LynxViewIOS;

  override createNativeView(): object {
    ensureEnvironment();
    const view = lynx()
      .LynxView.alloc()
      .initWithBuilderBlock((builder) => {
        builder.screenSize = {
          width: Screen.mainScreen.widthDIPs,
          height: Screen.mainScreen.heightDIPs,
        };
        builder.fontScale = 1;
      });
    view.layoutWidthMode = SIZE_MODE_EXACT;
    view.layoutHeightMode = SIZE_MODE_EXACT;
    // `src` can be applied before the first layout pass. Seed the constraints
    // with the screen so that first render is roughly right instead of 0×0;
    // onLayout replaces them with the box NativeScript actually gave us.
    view.preferredLayoutWidth = Screen.mainScreen.widthDIPs;
    view.preferredLayoutHeight = Screen.mainScreen.heightDIPs;
    return view as unknown as object;
  }

  // No teardown call: LynxView is a UIView and ARC releases it with the view
  // tree. (`clearForDestroy` exists but is for reuse pools, not disposal.)

  /**
   * Lynx lays the page out against the constraints it was given, so the
   * NativeScript-measured size has to reach it before the template renders.
   */
  override onLayout(left: number, top: number, right: number, bottom: number): void {
    super.onLayout(left, top, right, bottom);
    const view = this.nativeViewProtected;
    if (!view) return;
    // Lynx works in points; NativeScript measures in device pixels.
    view.preferredLayoutWidth = Utils.layout.toDeviceIndependentPixels(
      this.getMeasuredWidth(),
    );
    view.preferredLayoutHeight = Utils.layout.toDeviceIndependentPixels(
      this.getMeasuredHeight(),
    );
    view.triggerLayout();
  }

  override reload(): void {
    this.nativeViewProtected?.reloadTemplateWithTemplateDataGlobalProps(
      templateData(this.initDataJson()) ?? null,
      templateData(this.globalPropsJson()) ?? null,
    );
  }

  override updateData(data: LynxData): void {
    const json = data === undefined ? this.initDataJson() : toJson(data);
    const template = templateData(json);
    if (template) this.nativeViewProtected?.updateDataWithTemplateData(template);
  }

  override sendGlobalEvent(name: string, params: unknown[] = []): void {
    this.nativeViewProtected?.sendGlobalEventWithParams(name, params);
  }

  protected override renderBundle(binary: unknown, url: string): void {
    const meta = lynx().LynxLoadMeta.alloc().init();
    meta.url = url;
    meta.binaryData = binary;
    meta.initialData = templateData(this.initDataJson()) ?? null;
    meta.globalProps = templateData(this.globalPropsJson()) ?? null;

    this.nativeViewProtected.loadTemplate(meta);
    this.notifyLoaded(url);
  }
}

function toJson(data: LynxData): string | undefined {
  if (data === undefined) return undefined;
  return typeof data === 'string' ? data : JSON.stringify(data);
}
