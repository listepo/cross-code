"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectGenerator = exports.initGenerator = exports.runExecutor = exports.testExecutor = exports.buildExecutor = void 0;
// nx-buck2: Nx plugin for Buck2 native builds
var executor_1 = require("./executors/build/executor");
Object.defineProperty(exports, "buildExecutor", { enumerable: true, get: function () { return __importDefault(executor_1).default; } });
var executor_2 = require("./executors/test/executor");
Object.defineProperty(exports, "testExecutor", { enumerable: true, get: function () { return __importDefault(executor_2).default; } });
var executor_3 = require("./executors/run/executor");
Object.defineProperty(exports, "runExecutor", { enumerable: true, get: function () { return __importDefault(executor_3).default; } });
var generator_1 = require("./generators/init/generator");
Object.defineProperty(exports, "initGenerator", { enumerable: true, get: function () { return __importDefault(generator_1).default; } });
var generator_2 = require("./generators/project/generator");
Object.defineProperty(exports, "projectGenerator", { enumerable: true, get: function () { return __importDefault(generator_2).default; } });
