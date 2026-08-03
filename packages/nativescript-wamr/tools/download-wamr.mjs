// Downloads the WAMR (WebAssembly Micro Runtime) C sources from GitHub
// and extracts the required subset into src/vendors/wamr/.
//
// Usage:
//   node tools/download-wamr.mjs                # default tag (WAMR-2.3.0)
//   node tools/download-wamr.mjs WAMR-2.3.0     # specific tag
//   node tools/download-wamr.mjs 4c4a0ab        # specific commit
//
// After downloading, run:
//   npm run sync.vendors     # copies sources to iOS CWamr target
//   npm run build.android    # rebuilds the .aar with JavaCPP bindings

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(pkgRoot, 'src', 'vendors', 'wamr');

// WAMR GitHub repo.
const REPO = 'bytecodealliance/wasm-micro-runtime';
const DEFAULT_REF = 'WAMR-2.3.0';

// Subdirectories needed from the WAMR source tree. Everything else is
// skipped to keep the vendored copy small.
const REQUIRED_PATHS = [
  'core/iwasm/include',
  'core/iwasm/common',
  'core/iwasm/interpreter',
  'core/iwasm/fast-jit',
  'core/iwasm/compilation',
  'core/iwasm/aot',
  'core/iwasm/libraries',
  'core/shared/platform',
  'core/shared/mem-alloc',
  'core/shared/utils',
  'core/version.h',
  'LICENSE',
];

function run(cmd, opts) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function copyRecursive(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const srcStat = statSync(src);
  if (srcStat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyRecursive(join(src, entry), join(dest, entry));
    }
  } else {
    cpSync(src, dest);
  }
}

async function main() {
  const ref = process.argv[2] || DEFAULT_REF;
  const isCommit = /^[0-9a-f]{7,40}$/.test(ref);

  let url;
  let stripComponents;
  if (isCommit) {
    url = `https://github.com/${REPO}/archive/${ref}.tar.gz`;
    stripComponents = 1;
  } else {
    // Tag: WAMR-2.3.0 → the tarball extracts to wasm-micro-runtime-2.3.0/
    url = `https://github.com/${REPO}/archive/refs/tags/${ref}.tar.gz`;
    stripComponents = 1;
  }

  console.log(`Downloading WAMR ${ref} from ${REPO}...`);

  const tmpDir = join(pkgRoot, '.tmp-wamr-download');
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const tarball = join(tmpDir, 'wamr.tar.gz');

  // Download with curl (available on macOS, Linux, and CI runners).
  try {
    run(`curl -fsSL -o "${tarball}" "${url}"`);
  } catch {
    // Fallback: try the GitHub API for commit hashes.
    if (isCommit) {
      console.log('Direct archive download failed, trying GitHub API...');
      const apiUrl = `https://api.github.com/repos/${REPO}/tarball/${ref}`;
      run(`curl -fsSL -H "Accept: application/vnd.github+json" -o "${tarball}" "${apiUrl}"`);
      stripComponents = 1;
    } else {
      throw new Error(`Failed to download ${url}`);
    }
  }

  // Extract.
  console.log('Extracting tarball...');
  run(`tar -xzf "${tarball}" -C "${tmpDir}"`);

  // Find the extracted directory.
  const entries = readdirSync(tmpDir, { withFileTypes: true });
  const extractDir = entries.find(
    (e) => e.isDirectory() && e.name.startsWith('bytecodealliance-wasm-micro-runtime') || e.name.startsWith('wasm-micro-runtime'),
  );
  if (!extractDir) {
    throw new Error(
      `No WAMR source directory found in tarball. Contents: ${entries.map((e) => e.name).join(', ')}`,
    );
  }

  const srcDir = join(tmpDir, extractDir.name);

  // Verify we got the right thing.
  if (!existsSync(join(srcDir, 'core', 'iwasm'))) {
    throw new Error(
      `Unexpected tarball structure — expected core/iwasm/ in ${extractDir.name}. ` +
      `Contents: ${readdirSync(srcDir).join(', ')}`,
    );
  }

  // Clear and repopulate the vendor directory.
  console.log(`Copying required files to ${vendorDir}...`);
  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });

  let copied = 0;
  let skipped = 0;
  for (const relPath of REQUIRED_PATHS) {
    const srcPath = join(srcDir, relPath);
    if (!existsSync(srcPath)) {
      console.warn(`  ⚠ ${relPath} not found — skipping`);
      skipped++;
      continue;
    }
    const destPath = join(vendorDir, relPath);
    copyRecursive(srcPath, destPath);
    copied++;
  }

  // Write a README recording the version.
  writeFileSync(
    join(vendorDir, 'README.md'),
    `WAMR C sources — ${ref}\n` +
    `Downloaded from https://github.com/${REPO}\n\n` +
    `After updating, run:\n` +
    `  npm run sync.vendors     # copies sources to iOS CWamr target\n` +
    `  npm run build.android    # rebuilds the .aar with JavaCPP bindings\n`,
  );

  // Clean up.
  rmSync(tmpDir, { recursive: true, force: true });

  console.log(`Done — ${copied} paths vendored (${skipped} skipped) to ${vendorDir}`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
