// Plugin-level NativeScript config. The Lynx engine is a third-party SDK on
// both platforms: platforms/ios/Podfile and platforms/android/include.gradle
// declare it, and the {N} CLI merges each into the host app's build. There is
// no native source or prebuilt artifact in this package.
declare const __dirname: string;

export default {
  android: {
    includeGradle: [`${__dirname}/platforms/android/include.gradle`],
  },
} as NativeScriptConfig;
