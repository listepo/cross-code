// Plugin-level NativeScript config: the CLI merges these Swift Package
// declarations into the consuming app (app-level SPMPackages with the same
// name take precedence). The relative path is resolved against the app first
// and falls back to this plugin's install directory.
export default {
  ios: {
    SPMPackages: [
      {
        name: 'NSCWasm3',
        libs: ['NSCWasm3'],
        path: './platforms/ios/NSCWasm3',
      },
    ],
  },
};
