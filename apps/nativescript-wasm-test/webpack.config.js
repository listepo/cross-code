const { dirname } = require("node:path");
const webpack = require("@nativescript/webpack");

// The fixture .wasm binaries are build outputs of @cross-code/nativescript-wasm-fixture
// (wasm-pack + the gen_globals binary). Copy them into the bundle so wasm3 and
// WAMR can load them from the app folder at runtime — see app/wasm/wasm-assets.ts.
// Resolve via the package's own exports so this stays correct if the fixture's
// internal folder layout changes.
const fixturePkgDir = dirname(
	require.resolve("@cross-code/nativescript-wasm-fixture/types.wasm"),
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
