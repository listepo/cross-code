#!/usr/bin/env bash
# Thin wrapper — the shared builder lives at tools/build-xcframework.sh.
exec "$(dirname "$0")/../../../tools/build-xcframework.sh" NSCWamr
