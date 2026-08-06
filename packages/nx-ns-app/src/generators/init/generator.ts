import { type Tree, type GeneratorCallback, type TargetConfiguration, logger, updateProjectConfiguration } from '@nx/devkit';

export interface InitGeneratorOptions {
  project?: string;
  platforms?: ('ios' | 'android')[];
}

export default async function initGenerator(
  tree: Tree,
  options: InitGeneratorOptions,
): Promise<GeneratorCallback> {
  const project = options.project ?? 'ns-wasm-test';
  const platforms = options.platforms ?? ['ios', 'android'];

  const targets: Record<string, TargetConfiguration> = {};

  for (const platform of platforms) {
    targets[`build.${platform}`] = {
      executor: '@cross-code/nx-ns-app:build',
      options: { platform, configuration: 'debug', noHmr: true },
      dependsOn: [{ projects: 'dependencies', target: 'build' }],
      cache: true,
      inputs: ['production', '^production'],
      outputs: [`{projectRoot}/platforms/${platform}`],
    };
    targets[`run.${platform}`] = {
      executor: '@cross-code/nx-ns-app:run',
      options: { platform, device: 'emulator', noHmr: true },
      dependsOn: [`build.${platform}`],
      cache: false,
    };
    targets[`debug.${platform}`] = {
      executor: '@cross-code/nx-ns-app:debug',
      options: { platform, device: 'emulator' },
      dependsOn: [`build.${platform}`],
      cache: false,
    };
  }

  targets['clean'] = { executor: '@cross-code/nx-ns-app:clean' };
  targets['prepare'] = {
    executor: '@cross-code/nx-ns-app:prepare',
    options: { platform: platforms[0] },
    cache: true,
    inputs: ['production', '^production'],
    outputs: [`{projectRoot}/platforms/${platforms[0]}`],
  };

  updateProjectConfiguration(tree, project, {
    root: `apps/${project}`,
    projectType: 'application',
    sourceRoot: `apps/${project}/app`,
    targets,
  });

  await (await import('@nx/devkit')).formatFiles(tree);

  return () =>
    logger.info(`✅ nx-ns-app targets added to ${project} for ${platforms.join(', ')}`);
}
