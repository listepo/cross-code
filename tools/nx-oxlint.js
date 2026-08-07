// Nx inference plugin that adds oxlint lint targets to every TypeScript project.
// Registered in nx.json as "./tools/nx-oxlint.js".
const { join } = require('path');

/** @type {import('nx/src/utils/plugins').CreateNodes} */
const createNodes = [
  '**/package.json',
  (projectFile, opts, ctx) => {
    const root = projectFile.replace(/[\\/]package\.json$/, '');
    if (root === '.') return; // skip workspace root

    // Only configure if the project has src/**/*.ts (a TS library or app).
    try {
      const pkg = require(join(ctx.workspaceRoot, projectFile));
      if (!pkg.name) return;
    } catch {
      return;
    }

    // Already has a lint target defined in the project file — don't override.
    // (nx:run-script targets for e.g. lint.ios / lint.android are OK.)
    if (opts?.targets?.lint) return;

    return {
      projects: {
        [root]: {
          targets: {
            lint: {
              executor: 'nx:run-commands',
              options: {
                command: `npx oxlint --config ${ctx.workspaceRoot}/.oxlintrc.json --deny-warnings`,
                cwd: root,
              },
              cache: true,
              inputs: [
                '{projectRoot}/**/*.ts',
                '{projectRoot}/**/*.tsx',
                '{projectRoot}/tsconfig.json',
                '{workspaceRoot}/.oxlintrc.json',
              ],
            },
          },
        },
      },
    };
  },
];

module.exports = { createNodes };
