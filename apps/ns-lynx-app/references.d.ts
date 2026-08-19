// Composed with https://types.nativescript.org/agents — the native types that
// ship with @nativescript/types, narrowed to exactly what this app uses
// instead of the umbrella ./node_modules/@nativescript/types/index.d.ts.
//
// iOS: the default common bundle (runtime + the frameworks @nativescript/core
// relies on) plus the opt-in frameworks the app's platform code touches
// (UIKit — UIApplicationDelegate etc. in @nativescript/core's *.ios.d.ts).
// Android: the API level the app compiles against (App_Resources/Android:
// compileSdk/targetSdk 35).

/// <reference path="./node_modules/@nativescript/types-ios/lib/ios/common.d.ts" />
/// <reference path="./node_modules/@nativescript/types-ios/lib/ios/objc-x86_64/objc!UIKit.d.ts" />

/// <reference path="./node_modules/@nativescript/types-android/lib/android-35.d.ts" />
