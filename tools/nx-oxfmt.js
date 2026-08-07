// Nx inference plugin that adds oxfmt format targets to every TypeScript project.
// Registered in nx.json as "./tools/nx-oxfmt.js".
const { join } = require('path');

/** @type {import('nx/src/utils/plugins').CreateNodes} */
const createNodes = [
  '**/package.json',
  (projectFile, opts, ctx) => {
    const root = projectFile.replace(/[\\/]package\.json$/, '');
    if (root === '.') return;

    try {
      const pkg = require(join(ctx.workspaceRoot, projectFile));
      if (!pkg.name) return;
    } catch {
      return;
    }

    if (opts?.targets?.format) return;

    return {
      projects: {
        [root]: {
          targets: {
            format: {
              executor: 'nx:run-commands',
              options: {
                command: `npx oxfmt`,
                cwd: root,
              },
              cache: true,
              inputs: [
                '{projectRoot}/**/*.ts',
                '{projectRoot}/**/*.tsx',
                '{projectRoot}/**/*.js',
                '{projectRoot}/**/*.mjs',
              ],
            },
          },
        },
      },
    };
  },
];

module.exports = { createNodes };
