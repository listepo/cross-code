import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  CreateNodesContextV2,
  CreateNodesResultV2,
  CreateNodesV2,
  TargetConfiguration,
} from '@nx/devkit';

/** Every `package.json` Nx matches is fed through this before a target is added. */
export function isWorkspacePackage(
  projectFile: string,
  workspaceRoot: string,
): boolean {
  const path = projectFile.replace(/\\/g, '/');
  // dirname('package.json') === '.', which is how the workspace root is skipped.
  if (dirname(path) === '.') return false;
  // wasm-pack writes a package.json into pkg/; it is not an Nx project.
  if (path.endsWith('/pkg/package.json')) return false;
  try {
    const pkg: unknown = JSON.parse(
      readFileSync(join(workspaceRoot, projectFile), 'utf8'),
    );
    return typeof (pkg as { name?: unknown }).name === 'string';
  } catch {
    return false;
  }
}

/**
 * Builds the `CreateNodesV2` tuple shared by the oxlint and oxfmt plugins:
 * one cached target, attached to every workspace package.
 */
export function oxcCreateNodes(
  targetName: string,
  buildTarget: (root: string, context: CreateNodesContextV2) => TargetConfiguration,
): CreateNodesV2 {
  return [
    '**/package.json',
    (projectFiles, _options, context): CreateNodesResultV2 =>
      projectFiles
        .filter((projectFile) =>
          isWorkspacePackage(projectFile, context.workspaceRoot),
        )
        .map((projectFile) => {
          const root = dirname(projectFile);
          return [
            projectFile,
            {
              projects: {
                [root]: { targets: { [targetName]: buildTarget(root, context) } },
              },
            },
          ] as const;
        }),
  ];
}
