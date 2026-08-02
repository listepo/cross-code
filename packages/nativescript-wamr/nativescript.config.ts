// Plugin-level NativeScript config: the CLI merges these Swift Package
// declarations into the consuming app (an app-level SPMPackages entry with the
// same name takes precedence).
//
// The path has to be absolute. The CLI reads this file through
// Module.prototype._compile, so __dirname is this plugin's install directory —
// but it then resolves the SPM path against the *app*:
//
//   pkg.path = path.resolve(projectData.projectDir, pkg.path)
//     — lib/services/ios/spm-service.js, applySPMPackages()
//
// There is no plugin-relative fallback, so a relative path here resolves inside
// the consuming app and the build fails with "the package at … cannot be
// accessed". path.resolve leaves an absolute path untouched.
declare const __dirname: string;

export default {
  ios: {
    SPMPackages: [
      {
        name: 'NSCWamr',
        libs: ['NSCWamr'],
        path: `${__dirname}/platforms/ios/NSCWamr`,
      },
    ],
  },
  android: {
    includeGradle: [`${__dirname}/platforms/android/include.gradle`],
  },
} as NativeScriptConfig;
