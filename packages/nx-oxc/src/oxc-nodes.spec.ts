import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateNodesContextV2 } from '@nx/devkit';
import { isWorkspacePackage, oxcCreateNodes } from './oxc-nodes';

let workspaceRoot: string;
let context: CreateNodesContextV2;

function writePackage(relDir: string, contents: string): string {
  mkdirSync(join(workspaceRoot, relDir), { recursive: true });
  const file = join(relDir, 'package.json');
  writeFileSync(join(workspaceRoot, file), contents);
  return file;
}

beforeAll(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'nx-oxc-'));
  context = { workspaceRoot, nxJsonConfiguration: {} } as CreateNodesContextV2;
  writeFileSync(
    join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@cross-code/source' }),
  );
  writePackage('packages/lib-a', JSON.stringify({ name: '@cross-code/lib-a' }));
  writePackage(
    'packages/lib-b/pkg',
    JSON.stringify({ name: 'wasm-pack-output' }),
  );
  writePackage('packages/nameless', JSON.stringify({ version: '1.0.0' }));
  writePackage('packages/broken', '{ not json');
});

afterAll(() => rmSync(workspaceRoot, { recursive: true, force: true }));

describe('isWorkspacePackage', () => {
  it('accepts a named package', () => {
    expect(
      isWorkspacePackage('packages/lib-a/package.json', workspaceRoot),
    ).toBe(true);
  });

  it('skips the workspace root', () => {
    expect(isWorkspacePackage('package.json', workspaceRoot)).toBe(false);
  });

  it('skips wasm-pack pkg/ output', () => {
    expect(
      isWorkspacePackage('packages/lib-b/pkg/package.json', workspaceRoot),
    ).toBe(false);
  });

  it('skips a package.json without a name', () => {
    expect(
      isWorkspacePackage('packages/nameless/package.json', workspaceRoot),
    ).toBe(false);
  });

  it('skips unparseable and missing package.json files', () => {
    expect(
      isWorkspacePackage('packages/broken/package.json', workspaceRoot),
    ).toBe(false);
    expect(isWorkspacePackage('packages/gone/package.json', workspaceRoot)).toBe(
      false,
    );
  });

  it('normalizes windows separators', () => {
    expect(
      isWorkspacePackage('packages\\lib-b\\pkg\\package.json', workspaceRoot),
    ).toBe(false);
  });
});

describe('oxcCreateNodes', () => {
  const [pattern, createNodesFn] = oxcCreateNodes('check', (root) => ({
    executor: 'nx:run-commands',
    options: { command: 'npx checker', cwd: root },
  }));

  it('matches every package.json', () => {
    expect(pattern).toBe('**/package.json');
  });

  it('adds the target under the project root and skips non-projects', async () => {
    const result = await createNodesFn(
      [
        'package.json',
        'packages/lib-a/package.json',
        'packages/lib-b/pkg/package.json',
      ],
      undefined,
      context,
    );

    expect(result).toEqual([
      [
        'packages/lib-a/package.json',
        {
          projects: {
            'packages/lib-a': {
              targets: {
                check: {
                  executor: 'nx:run-commands',
                  options: { command: 'npx checker', cwd: 'packages/lib-a' },
                },
              },
            },
          },
        },
      ],
    ]);
  });
});
