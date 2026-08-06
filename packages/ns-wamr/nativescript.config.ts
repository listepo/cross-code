// Plugin-level NativeScript config. The iOS native code ships as a prebuilt
// NSCWamr.xcframework in platforms/ios/ — the CLI discovers and embeds it
// automatically (FRAMEWORK_EXTENSIONS in ios-project-service.js), so no
// SPMPackages entry is needed. Rebuild it with `npm run build.xcframework`.
declare const __dirname: string;

export default {
  android: {
    includeGradle: [`${__dirname}/platforms/android/include.gradle`],
  },
} as NativeScriptConfig;
