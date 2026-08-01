const { dirname, join } = require("node:path");
const webpack = require("@nativescript/webpack");

// The fixture .wasm binaries are build outputs of @org/nativescript-wasm-fixture
// (wasm-pack + the gen_globals binary). Copy them into the bundle so wasm3 can
// load them from the app folder at runtime — see app/wasm/wasm-assets.ts.
const fixturePkgDir = join(
	dirname(require.resolve("@org/nativescript-wasm-fixture/package.json")),
	"src",
	"test-types",
	"pkg",
);

module.exports = (env) => {
	webpack.init(env);

	// Learn how to customize:
	// https://docs.nativescript.org/webpack

	webpack.Utils.addCopyRule({
		from: "test_types_bg.wasm",
		to: "wasm/test_types.wasm",
		context: fixturePkgDir,
	});
	webpack.Utils.addCopyRule({
		from: "globals.wasm",
		to: "wasm/globals.wasm",
		context: fixturePkgDir,
	});

	return webpack.resolveConfig();
};
