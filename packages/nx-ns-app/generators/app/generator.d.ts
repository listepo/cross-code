import { type Tree, type GeneratorCallback } from '@nx/devkit';
export interface AppGeneratorOptions {
    name: string;
    directory?: string;
    platforms?: ('ios' | 'android')[];
}
export default function appGenerator(tree: Tree, options: AppGeneratorOptions): Promise<GeneratorCallback>;
