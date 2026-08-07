// Nx inference plugin that adds oxfmt format targets to every TypeScript project.
// Registered in nx.json as "./tools/nx-oxfmt.js".
const { dirname, join } = require('path');

/** Build the format target for a single matched package.json, or undefined to skip. */
function createNodesForFile(projectFile, opts, ctx) {
  // dirname('package.json') === '.', which is how the workspace root is skipped.
  const root = dirname(projectFile);
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
}

// Nx >= 21 calls createNodes with the *batch* of matched files and expects
// [configFile, result] tuples back.
/** @type {import('nx/src/project-graph/plugins').CreateNodesV2} */
const createNodes = [
  '**/package.json',
  (projectFiles, opts, ctx) => {
    const results = [];
    for (const projectFile of projectFiles) {
      const result = createNodesForFile(projectFile, opts, ctx);
      if (result) results.push([projectFile, result]);
    }
    return results;
  },
];

module.exports = { createNodes, createNodesV2: createNodes };
