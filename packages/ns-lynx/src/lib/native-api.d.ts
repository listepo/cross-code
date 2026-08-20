// Ambient shapes for the Lynx SDK classes NativeScript exposes to JavaScript.
//
// Nothing here is implemented by this package: Lynx ships the native code
// (CocoaPods `Lynx`/`PrimJS` on iOS, `org.lynxsdk.lynx:*` on Android) and
// NativeScript's metadata generator / static binding generator makes those
// classes reachable from JS. These declarations only describe the members
// ns-lynx calls, so the TypeScript build can check them without depending on
// `@nativescript/types-{ios,android}`.

/** Binary payload as each platform's `File.readSync()` returns it. */
export type NativeBinary = unknown;

export interface LynxTemplateDataIOS {
  updateWithJson(json: string): void;
}

export interface LynxLoadMetaIOS {
  url: string;
  binaryData: NativeBinary | null;
  initialData: LynxTemplateDataIOS | null;
  globalProps: LynxTemplateDataIOS | null;
}

export interface LynxViewIOS {
  preferredLayoutWidth: number;
  preferredLayoutHeight: number;
  layoutWidthMode: number;
  layoutHeightMode: number;
  loadTemplate(meta: LynxLoadMetaIOS): void;
  updateDataWithTemplateData(data: LynxTemplateDataIOS): void;
  sendGlobalEventWithParams(name: string, params: unknown[]): void;
  reloadTemplateWithTemplateDataGlobalProps(
    data: LynxTemplateDataIOS | null,
    globalProps: LynxTemplateDataIOS | null,
  ): void;
  triggerLayout(): void;
}

export interface LynxViewBuilderIOS {
  screenSize: { width: number; height: number };
  fontScale: number;
}

/** iOS globals published by the Lynx pod. */
export interface LynxGlobalIOS {
  LynxEnv?: { sharedInstance(): unknown };
  LynxView?: {
    alloc(): { initWithBuilderBlock(block: (builder: LynxViewBuilderIOS) => void): LynxViewIOS };
  };
  LynxLoadMeta?: { alloc(): { init(): LynxLoadMetaIOS } };
  LynxTemplateData?: {
    alloc(): { initWithJson(json: string): LynxTemplateDataIOS };
  };
}

export interface TemplateDataAndroid {
  markState(state: string): void;
}

export interface LynxLoadMetaBuilderAndroid {
  setUrl(url: string): void;
  setBinaryData(data: NativeBinary): void;
  setInitialData(data: TemplateDataAndroid): void;
  setGlobalProps(data: TemplateDataAndroid): void;
  build(): unknown;
}

export interface LynxViewAndroid {
  loadTemplate(meta: unknown): void;
  updateData(data: TemplateDataAndroid): void;
  /** Second parameter is a `com.lynx.react.bridge.JavaOnlyArray`. */
  sendGlobalEvent(name: string, params: unknown): void;
  reloadTemplate(data: TemplateDataAndroid | null, globalProps: TemplateDataAndroid | null): void;
  destroy(): void;
  setLayoutParams(params: unknown): void;
}

export interface LynxViewBuilderAndroid {
  build(context: unknown): LynxViewAndroid;
}

export interface LynxTasmAndroid {
  LynxEnv: { inst(): { init(app: unknown, a: null, b: null, c: null): void } };
  LynxViewBuilder: new () => LynxViewBuilderAndroid;
  LynxLoadMeta: { Builder: new () => LynxLoadMetaBuilderAndroid };
  TemplateData: { fromString(json: string): TemplateDataAndroid };
}

export interface JavaOnlyArrayAndroid {
  pushString(value: string): void;
  pushDouble(value: number): void;
  pushBoolean(value: boolean): void;
  pushNull(): void;
}

export interface LynxBridgeAndroid {
  com?: { lynx?: { react?: { bridge?: { JavaOnlyArray: new () => JavaOnlyArrayAndroid } } } };
}

/** Android globals published by the `org.lynxsdk.lynx` artifacts. */
export interface LynxGlobalAndroid {
  com?: { lynx?: { tasm?: LynxTasmAndroid } };
}
