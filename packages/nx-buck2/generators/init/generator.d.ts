import { type Tree, type GeneratorCallback } from '@nx/devkit';
export interface InitGeneratorOptions {
    language?: 'c' | 'rust' | 'swift' | 'kotlin';
    project?: string;
}
export default function initGenerator(tree: Tree, options: InitGeneratorOptions): Promise<GeneratorCallback>;
