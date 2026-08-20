import { Utils } from '@nativescript/core';
import { LynxError } from './bundle.js';
import { LynxViewBase, type LynxData } from './lynx-view-common.js';
import type {
  LynxBridgeAndroid,
  LynxGlobalAndroid,
  LynxTasmAndroid,
  LynxViewAndroid,
  TemplateDataAndroid,
} from './native-api.js';

let environmentReady = false;

function tasm(): LynxTasmAndroid {
  const lynx = (globalThis as unknown as LynxGlobalAndroid).com?.lynx?.tasm;
  if (!lynx) {
    throw new LynxError(
      'The Lynx Android SDK is missing. Add @cross-code/ns-lynx to the app so its include.gradle contributes the org.lynxsdk.lynx dependencies.',
    );
  }
  return lynx;
}

/**
 * `LynxEnv` is global and must be initialized before any other Lynx call.
 * Doing it on first view creation keeps the host app's Application class free
 * of Lynx setup — NativeScript apps do not own one by default.
 *
 * `init` is typed `android.app.Application`, not `Context`, so it takes the
 * {N} runtime's Application rather than the view's context.
 */
function ensureEnvironment(): void {
  if (environmentReady) return;
  tasm().LynxEnv.inst().init(Utils.android.getApplication(), null, null, null);
  environmentReady = true;
}

function templateData(json: string | undefined): TemplateDataAndroid | undefined {
  return json === undefined ? undefined : tasm().TemplateData.fromString(json);
}

export class LynxView extends LynxViewBase {
  declare nativeViewProtected: LynxViewAndroid;

  override createNativeView(): object {
    const context = (this as unknown as { _context: unknown })._context;
    ensureEnvironment();
    const builder = new (tasm().LynxViewBuilder)();
    return builder.build(context) as unknown as object;
  }

  override disposeNativeView(): void {
    this.nativeViewProtected?.destroy();
    super.disposeNativeView();
  }

  override reload(): void {
    this.nativeViewProtected?.reloadTemplate(
      templateData(this.initDataJson()) ?? null,
      templateData(this.globalPropsJson()) ?? null,
    );
  }

  override updateData(data: LynxData): void {
    const json = data === undefined ? this.initDataJson() : toJson(data);
    const template = templateData(json);
    if (template) this.nativeViewProtected?.updateData(template);
  }

  override sendGlobalEvent(name: string, params: unknown[] = []): void {
    this.nativeViewProtected?.sendGlobalEvent(name, eventParams(params));
  }

  protected override renderBundle(binary: unknown, url: string): void {
    const builder = new (tasm().LynxLoadMeta.Builder)();
    builder.setUrl(url);
    builder.setBinaryData(binary);

    const initial = templateData(this.initDataJson());
    if (initial) builder.setInitialData(initial);
    const props = templateData(this.globalPropsJson());
    if (props) builder.setGlobalProps(props);

    this.nativeViewProtected.loadTemplate(builder.build());
    this.notifyLoaded(url);
  }
}

function toJson(data: LynxData): string | undefined {
  if (data === undefined) return undefined;
  return typeof data === 'string' ? data : JSON.stringify(data);
}

/**
 * `sendGlobalEvent` is typed `(String, JavaOnlyArray)` — a plain `List` does
 * not match the overload. Primitives are pushed with their typed setters;
 * anything else is JSON-encoded, since NativeScript cannot marshal a JS object
 * into a Lynx `ReadableMap` on its own.
 */
function eventParams(params: unknown[]): unknown {
  const bridge = (globalThis as unknown as LynxBridgeAndroid).com?.lynx?.react
    ?.bridge;
  if (!bridge) throw new LynxError('The Lynx Android SDK is missing.');

  const array = new bridge.JavaOnlyArray();
  for (const param of params) {
    if (typeof param === 'string') array.pushString(param);
    else if (typeof param === 'number') array.pushDouble(param);
    else if (typeof param === 'boolean') array.pushBoolean(param);
    else if (param === null || param === undefined) array.pushNull();
    else array.pushString(JSON.stringify(param));
  }
  return array;
}
