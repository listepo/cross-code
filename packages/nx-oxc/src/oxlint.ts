// Nx inference plugin that adds an oxlint `lint` target to every workspace
// package. Registered in nx.json as "@cross-code/nx-oxc/oxlint".
import { oxcCreateNodes } from './oxc-nodes';

export const createNodesV2 = oxcCreateNodes('lint', (root, context) => ({
  executor: 'nx:run-commands',
  options: {
    // Quoted: workspaceRoot is a real filesystem path and may contain spaces.
    command: `npx oxlint --config "${context.workspaceRoot}/.oxlintrc.json" --deny-warnings`,
    cwd: root,
  },
  cache: true,
  // Every extension oxlint reads, or a change to one it lints but this list
  // omits replays a stale pass from the cache.
  inputs: [
    '{projectRoot}/**/*.ts',
    '{projectRoot}/**/*.tsx',
    '{projectRoot}/**/*.mts',
    '{projectRoot}/**/*.cts',
    '{projectRoot}/**/*.js',
    '{projectRoot}/**/*.jsx',
    '{projectRoot}/**/*.mjs',
    '{projectRoot}/**/*.cjs',
    '{projectRoot}/tsconfig.json',
    '{workspaceRoot}/.oxlintrc.json',
  ],
}));

// Nx >= 21 only calls createNodesV2; the alias keeps older tooling working.
export const createNodes = createNodesV2;
