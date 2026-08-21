import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CreateNodesContextV2,
  ProjectConfiguration,
  TargetConfiguration,
} from '@nx/devkit';
import { createNodes as oxfmtNodes, createNodesV2 as oxfmtV2 } from './oxfmt';
import { createNodes as oxlintNodes, createNodesV2 as oxlintV2 } from './oxlint';

let workspaceRoot: string;
let context: CreateNodesContextV2;

beforeAll(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'nx-oxc-plugins-'));
  context = { workspaceRoot, nxJsonConfiguration: {} } as CreateNodesContextV2;
  mkdirSync(join(workspaceRoot, 'packages/lib-a'), { recursive: true });
  writeFileSync(
    join(workspaceRoot, 'packages/lib-a/package.json'),
    JSON.stringify({ name: '@cross-code/lib-a' }),
  );
});

afterAll(() => rmSync(workspaceRoot, { recursive: true, force: true }));

async function targetFor(
  plugin: typeof oxlintV2,
  name: string,
): Promise<TargetConfiguration> {
  const [, createNodesFn] = plugin;
  const result = await createNodesFn(
    ['packages/lib-a/package.json'],
    undefined,
    context,
  );
  const projects = result[0][1].projects as Record<string, ProjectConfiguration>;
  const target = projects['packages/lib-a'].targets?.[name];
  if (!target) throw new Error(`no ${name} target`);
  return target;
}

describe('oxlint plugin', () => {
  it('runs oxlint against the workspace config from the project directory', async () => {
    const target = await targetFor(oxlintV2, 'lint');
    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({
      command: `npx oxlint --config "${workspaceRoot}/.oxlintrc.json" --deny-warnings`,
      cwd: 'packages/lib-a',
    });
  });

  it('caches on the shared config and every extension oxlint reads', async () => {
    const target = await targetFor(oxlintV2, 'lint');
    expect(target.cache).toBe(true);
    expect(target.inputs).toContain('{workspaceRoot}/.oxlintrc.json');
    // a change oxlint would catch but the inputs miss replays a stale pass
    for (const ext of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']) {
      expect(target.inputs).toContain(`{projectRoot}/**/*.${ext}`);
    }
  });

  it('exposes createNodes as an alias of createNodesV2', () => {
    expect(oxlintNodes).toBe(oxlintV2);
  });
});

describe('oxfmt plugin', () => {
  it('runs oxfmt from the project directory', async () => {
    const target = await targetFor(oxfmtV2, 'format');
    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({
      command: 'npx oxfmt',
      cwd: 'packages/lib-a',
    });
  });

  it('is never cached, because it rewrites the sources in place', async () => {
    const target = await targetFor(oxfmtV2, 'format');
    expect(target.cache).toBe(false);
    // nothing to restore on a hit, so there is nothing to hash either
    expect(target.outputs).toBeUndefined();
    expect(target.inputs).toBeUndefined();
  });

  it('exposes createNodes as an alias of createNodesV2', () => {
    expect(oxfmtNodes).toBe(oxfmtV2);
  });
});
