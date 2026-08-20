import { networkInterfaces } from 'node:os'

/** IPv4 addresses of the build host, baked into `__NS_DEV_HOST_IPS__`. */
export function getIPS(): string[] {
    const interfaces = networkInterfaces()

    return Object.values(interfaces)
        .map((bindings) =>
            bindings?.find(
                (binding) =>
                    !binding.internal &&
                    (binding.family === 'IPv4' || binding.family === (4 as never)),
            ),
        )
        .filter((binding) => !!binding)
        .map((binding) => binding.address)
}
