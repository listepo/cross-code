# SonarCloud OSS setup (cross-code)

Maintainer guide for the SonarCloud workflow in `.github/workflows/sonarcloud.yml` and the scanner
configuration in `sonar-project.properties`.

The `sonar.organization` / `sonar.projectKey` values (`listepo` / `listepo_cross-code`) are
**placeholders** until they match the SonarCloud UI after you import the project.
As of 2026-09-25 the public SonarCloud API reports no organization with the key
`listepo`, so the organization still has to be created (bound to the `listepo`
GitHub account) on first import.

## 1. Import the repository

1. Sign in at [sonarcloud.io](https://sonarcloud.io) with GitHub.
2. Create or pick the organization bound to the **listepo** GitHub account and choose
   the free plan for open-source (public) projects.
3. Import the **listepo/cross-code** repository.
4. Compare the **organization key** and **project key** shown in the UI with
   `sonar-project.properties`. If they differ, update the file so they match exactly;
   a mismatch makes the scan fail or report into the wrong project.

## 2. Turn Automatic Analysis off

This project is analyzed by CI (`SonarSource/sonarqube-scan-action`), so SonarCloud's
**Automatic Analysis** must be **off**. With both enabled, the CI scan fails with an
error about Automatic Analysis being enabled.

In the SonarCloud project: **Administration → Analysis Method → Automatic Analysis → off**.

## 3. Create a token

1. Open <https://sonarcloud.io/account/security>
   (**My Account → Security**, section **Access Tokens / Personal Tokens**).
2. Generate a token (for example `cross-code-github-actions`).
3. Copy the value; it is shown only once.

## 4. Add the `SONAR_TOKEN` secret

On **listepo/cross-code**: **Settings → Secrets and variables → Actions → New repository secret**

- Name: `SONAR_TOKEN`
- Value: the token from step 3

Never commit the token. Without the secret (fork pull requests, or before it is added)
every step in the workflow soft-skips with a notice, so the check stays green; a green
run in that state does **not** mean an analysis happened.

## 5. When the analysis runs

- On pull requests targeting `main` (draft pull requests are skipped until they are
  marked ready for review). Pull request decoration needs the SonarCloud GitHub App,
  which the import in step 1 installs.
- On every push to `main`.
- Manually via **Actions → sonarcloud → Run workflow**.

## 6. Soft-fail for now, blocking later

The workflow does not fail the build yet: the coverage and scan steps use
`continue-on-error: true`, and the Quality Gate is not awaited. To make it blocking
once the dashboard looks sane:

1. Remove `continue-on-error: true` from the scan (and, if wanted, coverage) steps.
2. Add `sonar.qualitygate.wait=true` to `sonar-project.properties` so the scan step
   fails when the Quality Gate fails.
3. Optionally mark the `sonarcloud` check as required in the branch protection rules
   for `main`.

## 7. Coverage

Coverage **is wired** with the tooling the repository already has (`@vitest/coverage-v8`
and the Nx `coverage` targets), mirroring the ci.yml `unit-tests` job:

```bash
pnpm install --frozen-lockfile
pnpm exec nx run-many -t build
rustup component add llvm-tools-preview
pnpm exec nx run-many -t coverage
```

Each TS package writes `packages/<pkg>/test-output/vitest/coverage/lcov.info`; the list
is in **`sonar.javascript.lcov.reportPaths`** (add new packages there). The Rust fixture
writes `packages/ns-wasm-fixture/target/coverage/lcov.info`, read through
**`sonar.rust.lcov.reportPaths`**. Missing files just mean less coverage, not a failed
scan. Native Swift/Kotlin coverage needs Xcode/JDK and is not collected here.

Scope: `packages/`, `apps/` and `tools/` (TypeScript, Kotlin, Swift, Rust). Specs and
test folders count as tests. Build output, `node_modules/`, NativeScript `App_Resources`,
generated wasm-pack output (`pkg/`), and the **vendored WAMR and wasm3 C sources**
(`src/vendors/wamr`, `src/vendors/wasm3`, and their copies under
`platforms/ios/*/Sources/CWamr|CWasm3`) are excluded.

### C and C++

GitHub lists this repository as C only because of the vendored WAMR and wasm3 runtimes;
the first-party code is TypeScript, Kotlin and Swift. The vendored C is excluded, and
C/C++/Objective-C analysis is turned off (`sonar.c.file.suffixes=-`,
`sonar.cpp.file.suffixes=-`, `sonar.objc.file.suffixes=-`) because SonarCloud's C-family
analyzer needs a compilation database, and the native code is built through Xcode,
Gradle/CMake (Android NDK) and Buck2 rather than one host build. Follow-up, only if
first-party C/C++ appears: generate `compile_commands.json` (for example
`CMAKE_EXPORT_COMPILE_COMMANDS=ON` for the Android CMake builds), set
`sonar.cfamily.compile-commands`, and remove the three suffix lines.

## 8. Local dry run (optional)

Run the scanner locally only with `SONAR_TOKEN` exported in your shell; never write the
token into the repository.

## References

- Workflow: `.github/workflows/sonarcloud.yml`
- Scanner configuration: `sonar-project.properties`
- [SonarQube Cloud documentation](https://docs.sonarsource.com/sonarqube-cloud/)
