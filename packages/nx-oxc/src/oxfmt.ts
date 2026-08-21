// Nx inference plugin that adds an oxfmt `format` target to every workspace
// package. Registered in nx.json as "@cross-code/nx-oxc/oxfmt".
import { oxcCreateNodes } from './oxc-nodes';

export const createNodesV2 = oxcCreateNodes('format', (root) => ({
  executor: 'nx:run-commands',
  options: {
    command: 'npx oxfmt',
    cwd: root,
  },
  // Never cached: oxfmt rewrites the sources in place, so there is no output
  // to restore. A cache hit would replay the recorded log and leave the files
  // untouched — e.g. after reverting to a state that was already formatted
  // once, or after editing .oxfmtrc.json, which is not part of any hash.
  cache: false,
}));

// Nx >= 21 only calls createNodesV2; the alias keeps older tooling working.
export const createNodes = createNodesV2;
