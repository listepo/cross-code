#!/usr/bin/env node
/**
 * Verify nested NativeScript app lockfiles stay in sync with linked workspace
 * packages (ns-rspack, ns-rstest, etc.). Each app under apps/* with its own
 * pnpm-workspace.yaml snapshots workspace: deps into its pnpm-lock.yaml — a
 * dependency change in packages/* must be followed by `pnpm install` in every
 * linked app, not just at the repo root.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Apps with their own pnpm-workspace.yaml and lockfile. Keep in sync with CI. */
const nestedApps = ['apps/ns-wasm-test', 'apps/ns-wry-app', 'apps/ns-lynx-app'];

let failed = false;

for (const relativeApp of nestedApps) {
  const appRoot = join(repoRoot, relativeApp);
  const lockfile = join(appRoot, 'pnpm-lock.yaml');

  if (!existsSync(lockfile)) {
    console.error(`::error::Missing ${relativeApp}/pnpm-lock.yaml`);
    failed = true;
    continue;
  }

  console.log(`Checking ${relativeApp}/pnpm-lock.yaml...`);
  const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
    cwd: appRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(
      `\n::error::${relativeApp}/pnpm-lock.yaml is stale. After changing dependencies in a linked workspace package (for example packages/ns-rspack/package.json), run:\n\n  cd ${relativeApp} && pnpm install\n\nThen commit the updated pnpm-lock.yaml.`,
    );
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
