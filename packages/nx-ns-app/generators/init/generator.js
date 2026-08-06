"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = initGenerator;
const devkit_1 = require("@nx/devkit");
async function initGenerator(tree, options) {
    const project = options.project ?? 'ns-wasm-test';
    const platforms = options.platforms ?? ['ios', 'android'];
    const targets = {};
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
    (0, devkit_1.updateProjectConfiguration)(tree, project, {
        root: `apps/${project}`,
        projectType: 'application',
        sourceRoot: `apps/${project}/app`,
        targets,
    });
    await (await Promise.resolve().then(() => __importStar(require('@nx/devkit')))).formatFiles(tree);
    return () => devkit_1.logger.info(`✅ nx-ns-app targets added to ${project} for ${platforms.join(', ')}`);
}
