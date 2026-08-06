#!/usr/bin/env bash
# Shared xcframework builder for all NativeScript engine plugins.
#
# Usage: tools/build-xcframework.sh <ENGINE>
#   ENGINE = NSCWamr | NSCWasm3 | NSCWry
#
# Builds <ENGINE>.xcframework (device arm64 + simulator arm64 + simulator
# x86_64) with size optimizations, plus dSYM bundles for symbolication.
# The engine name selects the package (ns-<engine-lowercase>) and product.
#
# The NativeScript CLI (9.x) picks up any platforms/ios/*.xcframework from a
# plugin automatically (FRAMEWORK_EXTENSIONS in ios-project-service.js), so
# the output only needs to be committed next to the SPM package.
#
# Notes:
# - The iOS 26 SDK still supports x86_64 simulator compilation for Intel Macs
#   and Rosetta-mode simulators on Apple Silicon. We ship an x86_64 simulator
#   slice so the framework links on every macOS host. The xcframework has
#   three slices: ios-arm64 (device), ios-arm64-simulator, ios-x86_64-simulator.
# - xcodebuild cannot be used from sandboxed terminals (nested sandbox-exec is
#   blocked), so each slice is built with `swift build --triple` + explicit
#   SDK flags, and the .xcframework bundle is assembled by hand (its layout is
#   just an Info.plist plus per-slice framework folders).
#
# Outputs (relative to the plugin root):
#   platforms/ios/<ENGINE>.xcframework        — shipped to the app
#   platforms/ios/<ENGINE>.xcframework.dSYMs/ — kept debug symbols (all slices)
set -euo pipefail

ENGINE="${1:?usage: build-xcframework.sh <ENGINE> (NSCWamr|NSCWasm3|NSCWry)}"

# Derive the package directory from the engine name: NSCWamr -> ns-wamr
PKG="ns-$(echo "${ENGINE#NSC}" | tr '[:upper:]' '[:lower:]')"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$ROOT/packages/$PKG"
cd "$PKG_DIR/platforms/ios/$ENGINE"

OUT=../$ENGINE.xcframework
DSYM_OUT=../$ENGINE.xcframework.dSYMs
BUILD=.build/xcframework-slices

rm -rf "$BUILD" "$OUT" "$DSYM_OUT"

build_slice() { # $1=triple $2=sdk-name $3=output-name
  local triple="$1" sdk_name="$2" out_name="$3"
  local sdk; sdk=$(xcrun --sdk "$sdk_name" --show-sdk-path)
  swift build --disable-sandbox -c release --product "$ENGINE" --triple "$triple" \
    -Xswiftc -sdk -Xswiftc "$sdk" \
    -Xcc -isysroot -Xcc "$sdk" \
    -Xswiftc -g -Xswiftc -Osize \
    -Xcc -g -Xcc -flto=thin \
    -Xlinker -dead_strip
  local dylib=".build/$triple/release/lib$ENGINE.dylib"

  # Assemble the framework bundle around the dylib.
  local fw="$BUILD/$out_name/$ENGINE.framework"
  mkdir -p "$fw/Headers" "$fw/Modules"
  cp "$dylib" "$fw/$ENGINE"
  cp Sources/$ENGINE/include/*.h "$fw/Headers/"
  # modulemap goes into Modules/ ONLY. A module.modulemap in Headers/ makes
  # the NativeScript metadata generator treat the headers as a clang module
  # and it then records none of the classes (TNSWidgets keeps it in Modules/
  # only and works).
  cp Sources/$ENGINE/include/module.modulemap "$fw/Modules/"
  # NOTE: deliberately NOT shipping the .swiftmodule — the NativeScript
  # metadata generator treats a framework with a Swift module as Swift-only
  # and skips its ObjC headers, so the classes would be invisible to the app.
  # The dylib's install name must point inside the framework bundle.
  install_name_tool -id "@rpath/$ENGINE.framework/$ENGINE" "$fw/$ENGINE"
  /usr/libexec/PlistBuddy -c "Clear dict" \
    -c "Add :CFBundleIdentifier string org.nativescript.$ENGINE" \
    -c "Add :CFBundleName string $ENGINE" \
    -c "Add :CFBundleExecutable string $ENGINE" \
    -c "Add :CFBundlePackageType string FMWK" \
    -c "Add :CFBundleVersion string 1" \
    -c "Add :CFBundleShortVersionString string 0.1.0" \
    "$fw/Info.plist" >/dev/null

  # dSYM from the UNSTRIPPED binary (release builds with -g carry DWARF).
  dsymutil "$fw/$ENGINE" -o "$BUILD/$out_name/$ENGINE.framework.dSYM" >/dev/null 2>&1 || true
}

# ── 1. Device slice (arm64) ─────────────────────────────────────────────
build_slice arm64-apple-ios iphoneos ios-arm64

# ── 2. Simulator slice (arm64) ──────────────────────────────────────────
build_slice arm64-apple-ios-simulator iphonesimulator ios-arm64-simulator

# ── 3. Simulator slice (x86_64) — needed for Intel Macs and Rosetta sims ─
build_slice x86_64-apple-ios-simulator iphonesimulator ios-x86_64-simulator

# ── 4. Strip the shipped binaries: local symbols + DWARF (keeps exported
#      dynamic symbols + ObjC runtime metadata; dSYMs retain everything). ─
strip -S -x "$BUILD/ios-arm64/$ENGINE.framework/$ENGINE"
strip -S -x "$BUILD/ios-arm64-simulator/$ENGINE.framework/$ENGINE"
strip -S -x "$BUILD/ios-x86_64-simulator/$ENGINE.framework/$ENGINE"

# ── 5. Assemble the XCFramework bundle by hand ──────────────────────────
mkdir -p "$OUT"
cat > "$OUT/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AvailableLibraries</key>
	<array>
		<dict>
			<key>LibraryIdentifier</key>
			<string>ios-arm64</string>
			<key>LibraryPath</key>
			<string>$ENGINE.framework</string>
			<key>SupportedArchitectures</key>
			<array><string>arm64</string></array>
			<key>SupportedPlatform</key>
			<string>ios</string>
		</dict>
		<dict>
			<key>LibraryIdentifier</key>
			<string>ios-arm64-simulator</string>
			<key>LibraryPath</key>
			<string>$ENGINE.framework</string>
			<key>SupportedArchitectures</key>
			<array><string>arm64</string></array>
			<key>SupportedPlatform</key>
			<string>ios</string>
			<key>SupportedPlatformVariant</key>
			<string>simulator</string>
		</dict>
		<dict>
			<key>LibraryIdentifier</key>
			<string>ios-x86_64-simulator</string>
			<key>LibraryPath</key>
			<string>$ENGINE.framework</string>
			<key>SupportedArchitectures</key>
			<array><string>x86_64</string></array>
			<key>SupportedPlatform</key>
			<string>ios</string>
			<key>SupportedPlatformVariant</key>
			<string>simulator</string>
		</dict>
	</array>
	<key>CFBundlePackageType</key>
	<string>XFWK</string>
	<key>XCFrameworkFormatVersion</key>
	<string>1.0</string>
</dict>
</plist>
PLIST
ditto "$BUILD/ios-arm64/$ENGINE.framework" "$OUT/ios-arm64/$ENGINE.framework"
ditto "$BUILD/ios-arm64-simulator/$ENGINE.framework" "$OUT/ios-arm64-simulator/$ENGINE.framework"
ditto "$BUILD/ios-x86_64-simulator/$ENGINE.framework" "$OUT/ios-x86_64-simulator/$ENGINE.framework"

# ── 6. Keep the dSYMs produced by dsymutil (all slices). ────────────────
for slice in ios-arm64 ios-arm64-simulator ios-x86_64-simulator; do
  ditto "$BUILD/$slice/$ENGINE.framework.dSYM" "$DSYM_OUT/$slice/$ENGINE.framework.dSYM"
done

echo "OK: $OUT ($(du -sh "$OUT" | cut -f1))"
echo "    dSYMs: $DSYM_OUT ($(du -sh "$DSYM_OUT" | cut -f1))"
