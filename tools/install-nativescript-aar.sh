#!/usr/bin/env bash
# Copy a Buck2-built AAR into the plugin tree NativeScript actually scans.
#
# Buck2 genrules materialize `srcs` under `.buck-out/.../srcs`. Gradle's
# deployAar task writes to `rootProject.projectDir.parentFile` relative to
# *that* sandbox, then the genrule copies the AAR to $OUT. NativeScript's
# vendor/gradle-plugin/build.gradle walks the *plugin* `platforms/android/`
# for `**/*.aar` — it never looks at buck-out — so without this copy the
# app builds, links only gradle-wrapper.jar from the nested Gradle project,
# and device tests fail with "native runtime not found".
#
# Same idea as tools/build-xcframework.sh writing into platforms/ios/.
#
# Usage: tools/install-nativescript-aar.sh <package> <aar-filename> <src-aar>
#   e.g. install-nativescript-aar.sh ns-wamr nativescript-wamr.aar "$OUT_ABS"
set -euo pipefail

PKG="${1:?usage: install-nativescript-aar.sh <package> <aar-filename> <src-aar>}"
NAME="${2:?usage: install-nativescript-aar.sh <package> <aar-filename> <src-aar>}"
SRC="${3:?usage: install-nativescript-aar.sh <package> <aar-filename> <src-aar>}"

ROOT="$(git rev-parse --show-toplevel)"
DEST="$ROOT/packages/$PKG/platforms/android/$NAME"

test -s "$SRC"
mkdir -p "$(dirname "$DEST")"
if [ "$SRC" -ef "$DEST" ]; then
  echo "already at $DEST ($(wc -c < "$DEST" | tr -d ' ') bytes)"
  exit 0
fi
cp "$SRC" "$DEST"
echo "installed $DEST ($(wc -c < "$DEST" | tr -d ' ') bytes)"
