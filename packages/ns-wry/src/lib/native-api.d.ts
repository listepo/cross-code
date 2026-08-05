// Minimal ambient declarations for the native classes this plugin ships.
// Full typings can be generated in an app with `ns typings ios|android`.

// iOS (Swift package NSCWry, exposed via @objc)
declare const NSCWryRuntime: any;

// Android (Kotlin classes packaged in nsc-wry.aar)
declare namespace org {
  namespace nativescript {
    namespace wry {
      const NSCWryRuntime: any;
    }
  }
}
