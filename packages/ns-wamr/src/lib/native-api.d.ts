// Minimal ambient declarations for the native classes this plugin ships.
// Full typings can be generated in an app with `ns typings ios|android`.

// iOS (Swift package NSCWamr, exposed via @objc)
declare const NSCWamrRuntime: any;
declare const NSCWamrHostCallback: any;
declare const NSData: any;
declare const NSMutableArray: any;
declare const interop: any;

// Android (Kotlin classes packaged in nativescript-wamr.aar)
declare namespace org {
  namespace nativescript {
    namespace wamr {
      const NSCWamrRuntime: any;
      const NSCWamrHostFunction: any;
    }
  }
}
