"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = initGenerator;
const devkit_1 = require("@nx/devkit");
const path = __importStar(require("node:path"));
async function initGenerator(tree, options) {
    const project = options.project ?? 'root';
    const projectRoot = project === 'root' ? '.' : `packages/${project}`;
    const lang = options.language ?? 'c';
    const buckFilePath = path.join(projectRoot, 'BUCK');
    if (tree.exists(buckFilePath)) {
        devkit_1.logger.warn(`BUCK file already exists at ${buckFilePath} — skipping`);
        return () => { };
    }
    const template = BUCK_TEMPLATES[lang] ?? BUCK_TEMPLATES.c;
    tree.write(buckFilePath, template(project));
    await (0, devkit_1.formatFiles)(tree);
    return () => {
        devkit_1.logger.info(`✅ Buck2 initialized for ${project} (${lang}). Run: buck2 build //${projectRoot}:all`);
    };
}
const BUCK_TEMPLATES = {
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
