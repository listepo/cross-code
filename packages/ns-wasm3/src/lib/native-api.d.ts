// Minimal ambient declarations for the native classes this plugin ships.
// Full typings can be generated in an app with `ns typings ios|android`.

// iOS (Swift package NSCWasm3, exposed via @objc)
declare const NSCWasm3Runtime: any;
declare const NSData: any;
declare const interop: any;

// Android (Kotlin classes packaged in nativescript-wasm3.aar)
declare namespace org {
  namespace nativescript {
    namespace wasm3 {
      const NSCWasm3Runtime: any;
      const NSCWasm3HostFunction: any;
    }
  }
}
