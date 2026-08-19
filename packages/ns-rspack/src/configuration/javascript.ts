import type { RspackChain } from 'rspack-chain'
import { getEnv, type INativeScriptRspackEnv } from '../env.js'
import { chainedSetAddAfter } from '../helpers/chain.js'
import { getEntryDirPath, getEntryPath } from '../helpers/platform.js'
import base from './base.js'
import { ownAsset, ownLoader } from './paths.js'

/** The base config plus the JavaScript `require.context` entry stub and core HMR. */
export default function javascript(
    config: RspackChain,
    env: INativeScriptRspackEnv = getEnv(),
): RspackChain {
    base(config, env)

    chainedSetAddAfter(
        config.entry('bundle'),
        '@nativescript/core/globals/index',
        ownAsset('stubs/entry-javascript.cjs'),
    )

    config.when(!!env.hmr, (chain) => {
        chain.module
            .rule('hmr-core')
            .before('js')
            .test(/\.js$/)
            .exclude.add(/node_modules/)
            .add(getEntryPath())
            .end()
            .use('nativescript-hot-loader')
            .loader(ownLoader('nativescript-hot-loader'))
            .options({ appPath: getEntryDirPath() })
    })

    return config
}
