import { type Tree, type GeneratorCallback, generateFiles, formatFiles, logger } from '@nx/devkit';
import * as path from 'node:path';

export interface AppGeneratorOptions {
  name: string;
  directory?: string;
  platforms?: ('ios' | 'android')[];
}

export default async function appGenerator(
  tree: Tree,
  options: AppGeneratorOptions,
): Promise<GeneratorCallback> {
  const dir = options.directory ?? `apps/${options.name}`;

  if (tree.exists(dir)) {
    logger.warn(`Directory ${dir} already exists — skipping scaffold`);
    return () => {};
  }

  // Create the project.json with ns-ns-app targets via the init generator
  const { default: initGen } = await import('../init/generator');
  await initGen(tree, { project: options.name, platforms: options.platforms });

  await formatFiles(tree);

  return () =>
    logger.info(
      `✅ NativeScript app ${options.name} scaffolded at ${dir}. Run \`ns create\` in that directory to generate the app source.`,
    );
}
