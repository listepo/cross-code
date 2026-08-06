"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appGenerator = exports.initGenerator = exports.prepareExecutor = exports.cleanExecutor = exports.debugExecutor = exports.runExecutor = exports.testExecutor = exports.buildExecutor = void 0;
// nx-ns-app: Nx plugin for NativeScript applications
var executor_1 = require("./executors/build/executor");
Object.defineProperty(exports, "buildExecutor", { enumerable: true, get: function () { return __importDefault(executor_1).default; } });
var executor_2 = require("./executors/test/executor");
Object.defineProperty(exports, "testExecutor", { enumerable: true, get: function () { return __importDefault(executor_2).default; } });
var executor_3 = require("./executors/run/executor");
Object.defineProperty(exports, "runExecutor", { enumerable: true, get: function () { return __importDefault(executor_3).default; } });
var executor_4 = require("./executors/debug/executor");
Object.defineProperty(exports, "debugExecutor", { enumerable: true, get: function () { return __importDefault(executor_4).default; } });
var executor_5 = require("./executors/clean/executor");
Object.defineProperty(exports, "cleanExecutor", { enumerable: true, get: function () { return __importDefault(executor_5).default; } });
var executor_6 = require("./executors/prepare/executor");
Object.defineProperty(exports, "prepareExecutor", { enumerable: true, get: function () { return __importDefault(executor_6).default; } });
var generator_1 = require("./generators/init/generator");
Object.defineProperty(exports, "initGenerator", { enumerable: true, get: function () { return __importDefault(generator_1).default; } });
var generator_2 = require("./generators/app/generator");
Object.defineProperty(exports, "appGenerator", { enumerable: true, get: function () { return __importDefault(generator_2).default; } });
