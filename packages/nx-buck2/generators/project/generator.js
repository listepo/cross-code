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
exports.default = projectGenerator;
const devkit_1 = require("@nx/devkit");
const path = __importStar(require("node:path"));
async function projectGenerator(tree, options) {
    const dir = options.directory ?? `packages/${options.name}`;
    if (tree.exists(dir)) {
        devkit_1.logger.warn(`Directory ${dir} already exists`);
        return () => { };
    }
    // Minimal package.json for an Nx project
    tree.write(path.join(dir, 'package.json'), JSON.stringify({
        name: `@cross-code/${options.name}`,
        private: true,
        nx: { name: options.name },
    }, null, 2));
    // Call the init generator to add the BUCK file
    const { default: initGen } = await Promise.resolve().then(() => __importStar(require('../init/generator')));
    await initGen(tree, { language: options.language, project: options.name });
    await (0, devkit_1.formatFiles)(tree);
    return () => devkit_1.logger.info(`✅ Buck2 project ${options.name} created at ${dir}`);
}
