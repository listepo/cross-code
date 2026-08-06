import { Tree, type GeneratorCallback, formatFiles, logger } from '@nx/devkit';
import * as path from 'node:path';

export interface ProjectGeneratorOptions {
  name: string;
  language: 'c' | 'rust' | 'swift' | 'kotlin';
  directory?: string;
}

export default async function projectGenerator(
  tree: Tree,
  options: ProjectGeneratorOptions,
): Promise<GeneratorCallback> {
  const dir = options.directory ?? `packages/${options.name}`;

  if (tree.exists(dir)) {
    logger.warn(`Directory ${dir} already exists`);
    return () => {};
  }

  // Minimal package.json for an Nx project
  tree.write(path.join(dir, 'package.json'), JSON.stringify({
    name: `@cross-code/${options.name}`,
    private: true,
    nx: { name: options.name },
  }, null, 2));

  // Call the init generator to add the BUCK file
  const { default: initGen } = await import('../init/generator');
  await initGen(tree, { language: options.language, project: options.name });

  await formatFiles(tree);

  return () => logger.info(`✅ Buck2 project ${options.name} created at ${dir}`);
}
