#!/usr/bin/env bash
# Build NSWasmKit.xcframework for iOS (device + simulator).
#
# Usage: tools/build-xcframework.sh
#   Set BUCK2_MODIFIER=debug for debug builds.
#
# Outputs (relative to the plugin root):
#   platforms/ios/NSWasmKit.xcframework
#   platforms/ios/NSWasmKit.xcframework.dSYMs/
set -euo pipefail

ENGINE="NSWasmKit"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$ROOT/platforms/ios/$ENGINE"
cd "$PKG_DIR"

# Support debug/release via BUCK2_MODIFIER env var
MODE="${BUCK2_MODIFIER:-release}"
SWIFT_CONF="$MODE"
# Release uses -Osize + thin LTO; debug uses -O0 -g
if [ "$MODE" = "debug" ]; then
  OPT_FLAGS="-Xswiftc -g -Xcc -g"
else
  OPT_FLAGS="-Xswiftc -g -Xswiftc -Osize -Xcc -g -Xcc -flto=thin -Xlinker -dead_strip"
fi

OUT="$ROOT/platforms/ios/$ENGINE.xcframework"
DSYM_OUT="$ROOT/platforms/ios/$ENGINE.xcframework.dSYMs"
BUILD="$PKG_DIR/.build/xcframework-slices"

rm -rf "$BUILD" "$OUT" "$DSYM_OUT"

build_slice() { # $1=triple $2=sdk-name $3=output-name
  local triple="$1" sdk_name="$2" out_name="$3"
  local sdk; sdk=$(xcrun --sdk "$sdk_name" --show-sdk-path)
  swift build --disable-sandbox -c "$SWIFT_CONF" --product "$ENGINE" --triple "$triple" \
    -Xswiftc -sdk -Xswiftc "$sdk" \
    -Xcc -isysroot -Xcc "$sdk" \
    $OPT_FLAGS
  local dylib="$PKG_DIR/.build/$triple/$SWIFT_CONF/lib$ENGINE.dylib"

  # Assemble the framework bundle around the dylib.
  local fw="$BUILD/$out_name/$ENGINE.framework"
  mkdir -p "$fw/Headers" "$fw/Modules"
  cp "$dylib" "$fw/$ENGINE"
  cp "$PKG_DIR/Sources/$ENGINE/include/"*.h "$fw/Headers/"
  cp "$PKG_DIR/Sources/$ENGINE/include/module.modulemap" "$fw/Modules/"
  install_name_tool -id "@rpath/$ENGINE.framework/$ENGINE" "$fw/$ENGINE"
  /usr/libexec/PlistBuddy -c "Clear dict" \
    -c "Add :CFBundleIdentifier string org.nativescript.$ENGINE" \
    -c "Add :CFBundleName string $ENGINE" \
    -c "Add :CFBundleExecutable string $ENGINE" \
    -c "Add :CFBundlePackageType string FMWK" \
    -c "Add :CFBundleVersion string 1" \
    -c "Add :CFBundleShortVersionString string 0.1.0" \
    "$fw/Info.plist" >/dev/null
}

SIM=ios-arm64_x86_64-simulator

# ── 1. Device slice (arm64) ─────────────────────────────────────────────
build_slice arm64-apple-ios iphoneos ios-arm64

# ── 2. Simulator slices — built per-arch, merged into one universal slice ─
build_slice arm64-apple-ios-simulator iphonesimulator sim-arm64
build_slice x86_64-apple-ios-simulator iphonesimulator sim-x86_64

# ── 3. Merge the simulator architectures into ONE universal slice ────────
ditto "$BUILD/sim-arm64/$ENGINE.framework" "$BUILD/$SIM/$ENGINE.framework"
lipo -create "$BUILD/sim-arm64/$ENGINE.framework/$ENGINE" \
             "$BUILD/sim-x86_64/$ENGINE.framework/$ENGINE" \
     -output "$BUILD/$SIM/$ENGINE.framework/$ENGINE"

# ── 4. dSYMs from the UNSTRIPPED binaries ───────────────────────────────
for slice in ios-arm64 "$SIM"; do
  dsymutil "$BUILD/$slice/$ENGINE.framework/$ENGINE" \
    -o "$BUILD/$slice/$ENGINE.framework.dSYM" >/dev/null 2>&1 || true
done

# ── 5. Strip the shipped binaries (release only) ────────────────────────
if [ "$MODE" = "release" ]; then
  strip -S -x "$BUILD/ios-arm64/$ENGINE.framework/$ENGINE"
  strip -S -x "$BUILD/$SIM/$ENGINE.framework/$ENGINE"
fi

# ── 6. Assemble the XCFramework bundle ──────────────────────────────────
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
			<string>$SIM</string>
			<key>LibraryPath</key>
			<string>$ENGINE.framework</string>
			<key>SupportedArchitectures</key>
			<array><string>arm64</string><string>x86_64</string></array>
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
ditto "$BUILD/$SIM/$ENGINE.framework" "$OUT/$SIM/$ENGINE.framework"

# ── 7. Keep the dSYMs ───────────────────────────────────────────────────
for slice in ios-arm64 "$SIM"; do
  ditto "$BUILD/$slice/$ENGINE.framework.dSYM" "$DSYM_OUT/$slice/$ENGINE.framework.dSYM"
done

echo "OK: $OUT ($(du -sh "$OUT" | cut -f1))"
echo "    dSYMs: $DSYM_OUT ($(du -sh "$DSYM_OUT" | cut -f1))"
