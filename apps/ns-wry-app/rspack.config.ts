import rspack from '@nativescript/rspack'
import type { INativeScriptRspackEnv } from '@nativescript/rspack'

export default (env: INativeScriptRspackEnv) => {
  rspack.init(env)

  // Customize the same way as @nativescript/webpack:
  //   rspack.chainRspack((config, env) => { ... })
  //   rspack.mergeRspack({ ... })

  return rspack.resolveConfig()
}
