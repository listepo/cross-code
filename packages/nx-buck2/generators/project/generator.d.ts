import { Tree, type GeneratorCallback } from '@nx/devkit';
export interface ProjectGeneratorOptions {
    name: string;
    language: 'c' | 'rust' | 'swift' | 'kotlin';
    directory?: string;
}
export default function projectGenerator(tree: Tree, options: ProjectGeneratorOptions): Promise<GeneratorCallback>;
