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
exports.default = appGenerator;
const devkit_1 = require("@nx/devkit");
async function appGenerator(tree, options) {
    const dir = options.directory ?? `apps/${options.name}`;
    if (tree.exists(dir)) {
        devkit_1.logger.warn(`Directory ${dir} already exists — skipping scaffold`);
        return () => { };
    }
    // Create the project.json with ns-ns-app targets via the init generator
    const { default: initGen } = await Promise.resolve().then(() => __importStar(require('../init/generator')));
    await initGen(tree, { project: options.name, platforms: options.platforms });
    await (0, devkit_1.formatFiles)(tree);
    return () => devkit_1.logger.info(`✅ NativeScript app ${options.name} scaffolded at ${dir}. Run \`ns create\` in that directory to generate the app source.`);
}
