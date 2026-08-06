import { type Tree, type GeneratorCallback } from '@nx/devkit';
export interface InitGeneratorOptions {
    project?: string;
    platforms?: ('ios' | 'android')[];
}
export default function initGenerator(tree: Tree, options: InitGeneratorOptions): Promise<GeneratorCallback>;
