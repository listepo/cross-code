#!/usr/bin/env bash
# Retries a gradlew invocation from the current directory.
#
# The rustup "no default toolchain configured" failure this was originally
# added for is now fixed at its actual root cause: nx-buck2's executors
# override HOME for buck2's daemon dir, which broke rustup's $HOME/.rustup
# toolchain lookup for every genrule-spawned cargo/gradle process (see
# packages/nx-buck2/src/lib/buck2-cmd.ts's withRustupHomeFix and this file's
# own gotcha above). Retry never actually fixed that error — it's
# deterministic given a broken HOME, not flaky.
#
# What's left to work around here: an unrelated, still-unexplained Gradle
# task-graph error ("could not determine the dependencies of task") seen
# once, only when gradlew is spawned via a buck2 genrule — not reproduced
# via a direct shell invocation, and not a stale/competing Gradle daemon
# (verified with --no-daemon). Kept as cheap defense-in-depth; --no-daemon
# itself is good practice regardless of whether the retry ever triggers.
#
# Usage: tools/gradlew-retry.sh <gradlew task args...>
#   (run after cd-ing to the Android project directory, i.e. the one with
#   ./gradlew in it)
set -euo pipefail

n=0
until ./gradlew --no-daemon "$@"; do
  n=$((n + 1))
  if [ "$n" -ge 3 ]; then
    exit 1
  fi
  echo "gradlew $* failed (attempt $n/3), retrying..." 1>&2
  sleep 3
done
