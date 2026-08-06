#!/usr/bin/env node
// Auto-generates the wasm3 JNI bindings with JavaCPP and cross-compiles the
// native library (wasm3 + generated JNI glue) for all Android ABIs, plus the
// host platform so the bindings can be exercised by JVM tests.
//
//   node build-native.mjs parse     # generate + compile the Java bindings only
//   node build-native.mjs host      # ...plus host (macOS) native lib for tests
//   node build-native.mjs android   # ...plus all four Android ABI .so files
//   node build-native.mjs all       # everything (default)
//
// Prerequisites: Node 18+, JDK 17+, Android NDK, and
// library/build/tools/javacpp.jar (fetched via `./gradlew :library:fetchJavacpp`).
import { fileURLToPath } from 'node:url';
import { $, ProcessOutput, echo, fs, glob, os, path } from 'zx';

// Compiler/JavaCPP output streams straight through to the terminal (Gradle
// logs); a non-zero exit rejects, so failures abort the script.
const run = $({ stdio: ['ignore', 'inherit', 'inherit'] });

const MODES = ['parse', 'host', 'android', 'all'];
const mode = process.argv[2] ?? 'all';

const root = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(root, '../../..');
const vendor = path.join(pluginRoot, 'src/vendors/wasm3');
const shim = path.join(pluginRoot, 'src/native/shim');
const lib = path.join(root, 'library');
const gen = path.join(lib, 'build/generated/javacpp');
const native = path.join(lib, 'build/native');
const javacppJar = path.join(lib, 'build/tools/javacpp.jar');

const BUILDER = 'org.bytedeco.javacpp.tools.Builder';
const BINDINGS = 'org.wasm3.**';
const API = 21;

const androidSdk = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
const includePath = [vendor, shim].join(path.delimiter);
const classpath = (...entries) => entries.join(path.delimiter);

// ---------------------------------------------------------------------------
// 1) Parse wasm3.h -> generated Java API, then compile it
// ---------------------------------------------------------------------------
async function parse() {
  echo('==> JavaCPP parse: generating org.wasm3 bindings');
  for (const dir of ['java', 'classes', 'presets']) {
    await fs.remove(path.join(gen, dir));
    await fs.mkdirp(path.join(gen, dir));
  }

  await run`javac -cp ${javacppJar} -d ${path.join(gen, 'presets')} ${path.join(lib, 'src/javacpp/org/wasm3/presets/wasm3.java')}`;

  await run`java -cp ${classpath(javacppJar, path.join(gen, 'presets'))} ${BUILDER} org.wasm3.presets.wasm3 -Dplatform.includepath=${includePath} -d ${path.join(gen, 'java')}`;

  await run`javac -cp ${classpath(javacppJar, path.join(gen, 'presets'))} -d ${path.join(gen, 'classes')} ${await glob(`${gen}/java/**/*.java`)}`;
}

// ---------------------------------------------------------------------------
// 2) Native builds: wasm3 static lib + JavaCPP-generated JNI lib
// ---------------------------------------------------------------------------
async function buildM3(cc, ar, out) {
  await fs.remove(out);
  await fs.mkdirp(path.join(out, 'obj'));

  const sources = [...(await glob(`${vendor}/*.c`)), ...(await glob(`${shim}/*.c`))];
  for (const source of sources) {
    const obj = path.join(out, 'obj', `${path.basename(source, '.c')}.o`);
    await run`${cc} -O3 -fPIC -std=gnu11 -I ${vendor} -I ${shim} -c ${source} -o ${obj}`;
  }

  await run`${ar} rcs ${path.join(out, 'libm3.a')} ${await glob(`${out}/obj/*.o`)}`;
}

async function buildJni(platform, libdir, overrides = []) {
  await fs.remove(path.join(gen, 'jni', platform));

  const presets = path.join(gen, 'presets');
  const classes = path.join(gen, 'classes');
  await run`java -cp ${classpath(javacppJar, presets, classes)} ${BUILDER} -cp ${presets} -cp ${classes} ${BINDINGS} -properties ${platform} -Dplatform.includepath=${includePath} -Dplatform.linkpath=${libdir} ${overrides} -d ${path.join(gen, 'jni', platform)}`;
}

// Copies every JavaCPP-built library matching `pattern` into `dest`.
async function collectLibs(platform, pattern, dest) {
  await fs.mkdirp(dest);
  for (const built of await glob(`${gen}/jni/${platform}/**/${pattern}`)) {
    await fs.copy(built, path.join(dest, path.basename(built)));
  }
}

// JavaCPP platform name for the machine running this script: macosx-arm64,
// macosx-x86_64, linux-x86_64, linux-arm64 (see javacpp.jar .../properties/).
function hostPlatform() {
  const arch = os.machine().replace('aarch64', 'arm64').replace('amd64', 'x86_64');
  switch (os.type()) {
    case 'Darwin':
      return `macosx-${arch}`;
    case 'Linux':
      return `linux-${arch}`;
    default:
      throw new Error(`unsupported host OS ${os.type()} for JVM tests`);
  }
}

async function buildHost() {
  echo('==> Host build (JVM tests)');
  const out = path.join(native, 'host');
  await buildM3(process.env.CC || 'cc', process.env.AR || 'ar', out);

  const platform = hostPlatform();
  await buildJni(platform, out);

  const hostDir = path.join(gen, 'host');
  await collectLibs(platform, 'libjniwasm3.*', hostDir);
  echo(`    -> ${hostDir}/${(await fs.readdir(hostDir)).join(' ')}`);
}

// Newest NDK installed under $ANDROID_HOME/ndk, or undefined if there is none.
function latestNdk() {
  const ndkRoot = path.join(androidSdk, 'ndk');
  if (!fs.existsSync(ndkRoot)) return undefined;
  const versions = fs
    .readdirSync(ndkRoot)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return versions.length ? path.join(ndkRoot, versions.at(-1)) : undefined;
}

async function buildAndroid() {
  const ndk = process.env.ANDROID_NDK_HOME || latestNdk();
  if (!ndk || !fs.existsSync(ndk)) {
    throw new Error('Android NDK not found (set ANDROID_NDK_HOME or ANDROID_HOME)');
  }

  const prebuilt = path.join(ndk, 'toolchains/llvm/prebuilt');
  const [hostTag] = fs.existsSync(prebuilt) ? fs.readdirSync(prebuilt).sort() : [];
  if (!hostTag) throw new Error(`no LLVM toolchain under ${prebuilt}`);
  const toolchain = path.join(prebuilt, hostTag, 'bin');

  const abis = [
    ['arm64-v8a', 'aarch64-linux-android', 'android-arm64'],
    ['armeabi-v7a', 'armv7a-linux-androideabi', 'android-arm'],
    ['x86', 'i686-linux-android', 'android-x86'],
    ['x86_64', 'x86_64-linux-android', 'android-x86_64'],
  ];

  for (const [abi, triple, platform] of abis) {
    echo(`==> Android build: ${abi}`);
    const out = path.join(native, abi);
    const cc = path.join(toolchain, `${triple}${API}-clang`);

    await buildM3(cc, path.join(toolchain, 'llvm-ar'), out);
    await buildJni(platform, out, [
      `-Dplatform.root=${ndk}`,
      `-Dplatform.compiler=${cc}++`,
      '-Xcompiler',
      '-Wl,-z,max-page-size=16384',
    ]);
    await collectLibs(platform, 'libjniwasm3.so', path.join(gen, 'jniLibs', abi));
  }
}

async function main() {
  if (!MODES.includes(mode)) {
    throw new Error(`unknown mode '${mode}' (expected ${MODES.join(' | ')})`);
  }
  if (!fs.existsSync(javacppJar)) {
    throw new Error(`${javacppJar} not found — run ./gradlew :library:fetchJavacpp first`);
  }

  // host/android builds reuse an existing parse if present
  if (mode === 'parse' || mode === 'all' || !fs.existsSync(path.join(gen, 'classes'))) {
    await parse();
  }
  if (mode === 'parse') return;

  if (mode === 'host' || mode === 'all') await buildHost();
  if (mode === 'android' || mode === 'all') await buildAndroid();

  echo('==> done');
}

try {
  await main();
} catch (err) {
  // A failed child already streamed its own diagnostics; keep the trailer short.
  const exitCode = Number.isInteger(err?.exitCode) ? err.exitCode : 1;
  console.error(
    err instanceof ProcessOutput
      ? `error: build step failed (exit ${exitCode})`
      : `error: ${err.message ?? err}`,
  );
  process.exit(exitCode || 1);
}
