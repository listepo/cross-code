/// <reference types="@lynx-js/rspeedy/client" />

declare module '@lynx-js/types' {
  interface GlobalProps {
    /** Set from the NativeScript host through `<LynxView globalProps="…">`. */
    hostPlatform?: string;
  }
}

export {};
