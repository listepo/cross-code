// Native type declarations for the Endive Kotlin classes exposed on globalThis
// by the NativeScript Android runtime (org.nativescript.endive.*).
//
// Generate with: cd apps/ns-wasm-test && ns typings android

declare namespace org.nativescript.endive {
  class NSCEndiveRuntime {
    static endiveVersion(): string;
    constructor(stackSizeInBytes: number);
    loadModuleFromBytes(bytes: java.util.ArrayList<number>): NSCEndiveModule;
    loadModuleFromFile(path: string): NSCEndiveModule;
    findFunction(name: string): NSCEndiveFunction;
    memorySize(): number;
    readMemory(offset: number, length: number): java.util.ArrayList<number>;
    writeMemory(offset: number, bytes: java.util.ArrayList<number>): void;
    dispose(): void;
    static jsByteArrayToJava(buffer: ArrayBuffer, offset: number, length: number): java.util.ArrayList<number>;
    static javaByteArrayToJs(bytes: java.util.ArrayList<number>): ArrayBuffer;
  }

  class NSCEndiveModule {
    name(): string;
    linkHostFunction(mod: string, name: string, signature: string, callback: NSCEndiveHostCallback): void;
    getGlobal(name: string): any;
    setGlobal(name: string, value: any): void;
  }

  class NSCEndiveFunction {
    name(): string;
    paramTypes(): string[];
    returnTypes(): string[];
    call(args: java.util.ArrayList<any>): java.util.ArrayList<any>;
  }

  class NSCEndiveHostCallback {
    constructor(callback: (args: any[]) => any[]);
  }
}
