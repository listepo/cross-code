import {
  type Tree,
  type GeneratorCallback,
  formatFiles,
  logger,
} from '@nx/devkit';
import * as path from 'node:path';

export interface InitGeneratorOptions {
  language?: 'c' | 'rust' | 'swift' | 'kotlin';
  project?: string;
}

export default async function initGenerator(
  tree: Tree,
  options: InitGeneratorOptions,
): Promise<GeneratorCallback> {
  const project = options.project ?? 'root';
  const projectRoot = project === 'root' ? '.' : `packages/${project}`;
  const lang = options.language ?? 'c';

  const buckFilePath = path.join(projectRoot, 'BUCK');

  if (tree.exists(buckFilePath)) {
    logger.warn(`BUCK file already exists at ${buckFilePath} — skipping`);
    return () => {};
  }

  const template = BUCK_TEMPLATES[lang] ?? BUCK_TEMPLATES.c;

  tree.write(buckFilePath, template(project));

  await formatFiles(tree);

  return () => {
    logger.info(`✅ Buck2 initialized for ${project} (${lang}). Run: buck2 build //${projectRoot}:all`);
  };
}

const BUCK_TEMPLATES: Record<string, (name: string) => string> = {
  c: (name) => `# Buck2 build definitions for ${name}
# Native C library — edit targets below.

load("@prelude//cxx:cxx_library.bzl", "cxx_library")

cxx_library(
    name = "${name}",
    srcs = glob(["src/**/*.c"]),
    headers = glob(["src/**/*.h"]),
    compiler_flags = select({
        "//toolchains:debug": ["-O0", "-g3"],
        "//toolchains:release": ["-Oz", "-flto=thin"],
    }),
    link_style = "static",
    visibility = ["PUBLIC"],
)
`,
  rust: (name) => `# Buck2 build definitions for ${name}
# Rust library — uses Cargo under the hood via genrule.

genrule(
    name = "${name}",
    srcs = glob(["src/**/*.rs", "Cargo.toml", "Cargo.lock"]),
    out = "lib${name}.a",
    cmd = "cargo build --release --manifest-path $SRCDIR/Cargo.toml && cp target/release/lib${name}.a $OUT",
    visibility = ["PUBLIC"],
)
`,
  swift: (name) => `# Buck2 build definitions for ${name}
# Swift library — Apple platforms only.

apple_library(
    name = "${name}",
    srcs = glob(["Sources/**/*.swift"]),
    headers = glob(["Sources/**/include/**/*.h"]),
    bridging_header = "Sources/${name}/include/${name}.h",
    platforms = ["iphoneos", "iphonesimulator"],
    swift_compiler_flags = select({
        "//toolchains:debug": ["-Onone", "-g"],
        "//toolchains:release": ["-Osize", "-whole-module-optimization"],
    }),
    visibility = ["PUBLIC"],
)
`,
  kotlin: (name) => `# Buck2 build definitions for ${name}
# Kotlin JVM library.

kotlin_library(
    name = "${name}",
    srcs = glob(["src/main/kotlin/**/*.kt"]),
    deps = [],
    visibility = ["PUBLIC"],
)
`,
};
