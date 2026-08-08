// Nx inference plugin that adds oxlint lint targets to every TypeScript project.
// Registered in nx.json as "./tools/nx-oxlint.js".
const { dirname, join } = require('path');

/** Build the lint target for a single matched package.json, or undefined to skip. */
function createNodesForFile(projectFile, opts, ctx) {
  // dirname('package.json') === '.', which is how the workspace root is skipped.
  const root = dirname(projectFile);
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
