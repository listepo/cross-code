# Toolchain

Программы проекта и прямые пакеты из манифестов.

## Программы

| Программа | Как ставить | Зачем здесь | Источник |
| --- | --- | --- | --- |
| mise | brew / curl, затем `mise install` | Пины версий инструментов | https://github.com/jdx/mise |
| node | mise | JS runtime | https://github.com/nodejs/node |
| java | mise | JDK | https://github.com/adoptium/temurin-build |
| pnpm | mise | JS workspace | https://github.com/pnpm/pnpm |
| buck2 | mise | Native-сборка | https://github.com/facebook/buck2 |
| rustc | rustup / системный | Компилятор Rust | https://github.com/rust-lang/rust |
| cargo | вместе с rustc | Сборка и зависимости Rust | https://github.com/rust-lang/cargo |

## cargo

| Пакет | Где | Источник | Зачем здесь |
| --- | --- | --- | --- |
| console_error_panic_hook | локально | https://crates.io/crates/console_error_panic_hook | The `console_error_panic_hook` crate provides better debugging of panics by logging them with `console.error`. This is great for development, but requires all the `std::fmt` and `std::panicking` infrastructure, so isn't great for code size when deploying. |
| wasm-bindgen | локально | https://crates.io/crates/wasm-bindgen | Зависимость Rust |
| wasm-bindgen-test | локально | https://crates.io/crates/wasm-bindgen-test | Зависимость Rust |

## npm / pnpm

| Пакет | Где | Источник | Зачем здесь |
| --- | --- | --- | --- |
| @cross-code/nx-buck2 | локально | https://www.npmjs.com/package/@cross-code/nx-buck2 | Пакет этого репозитория |
| @cross-code/nx-ns-app | локально | https://www.npmjs.com/package/@cross-code/nx-ns-app | Пакет этого репозитория |
| @cross-code/nx-oxc | локально | https://www.npmjs.com/package/@cross-code/nx-oxc | Пакет этого репозитория |
| @nx/devkit | локально | https://www.npmjs.com/package/@nx/devkit | JS-зависимость |
| @nx/js | локально | https://www.npmjs.com/package/@nx/js | JS-зависимость |
| @nx/plugin | локально | https://www.npmjs.com/package/@nx/plugin | JS-зависимость |
| @nx/vite | локально | https://www.npmjs.com/package/@nx/vite | JS-зависимость |
| @nx/vitest | локально | https://www.npmjs.com/package/@nx/vitest | JS-зависимость |
| @nx/web | локально | https://www.npmjs.com/package/@nx/web | JS-зависимость |
| @swc-node/register | локально | https://www.npmjs.com/package/@swc-node/register | JS-зависимость |
| @swc/core | локально | https://www.npmjs.com/package/@swc/core | JS-зависимость |
| @swc/helpers | локально | https://www.npmjs.com/package/@swc/helpers | JS-зависимость |
| @types/node | локально | https://www.npmjs.com/package/@types/node | Типы Node |
| @vitest/coverage-v8 | локально | https://www.npmjs.com/package/@vitest/coverage-v8 | JS-зависимость |
| agent-device | локально | https://www.npmjs.com/package/agent-device | JS-зависимость |
| jiti | локально | https://www.npmjs.com/package/jiti | JS-зависимость |
| nativescript | локально | https://www.npmjs.com/package/nativescript | NativeScript CLI |
| nx | локально | https://www.npmjs.com/package/nx | Монорепа |
| oxfmt | локально | https://www.npmjs.com/package/oxfmt | JS-зависимость |
| oxlint | локально | https://www.npmjs.com/package/oxlint | JS-зависимость |
| prettier | локально | https://www.npmjs.com/package/prettier | Формат |
| skills | локально | https://www.npmjs.com/package/skills | JS-зависимость |
| tslib | локально | https://www.npmjs.com/package/tslib | JS-зависимость |
| typescript | локально | https://www.npmjs.com/package/typescript | Типы / сборка TS |
| verdaccio | локально | https://www.npmjs.com/package/verdaccio | JS-зависимость |
| vite | локально | https://www.npmjs.com/package/vite | Сборка |
| vitest | локально | https://www.npmjs.com/package/vitest | Тесты |
| zx | локально | https://www.npmjs.com/package/zx | JS-зависимость |
