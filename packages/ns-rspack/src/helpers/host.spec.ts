import { describe, expect, it, vi } from 'vitest'

vi.mock('node:os', () => ({
    networkInterfaces: vi.fn(),
}))

import { networkInterfaces } from 'node:os'
import { getIPS } from './host.js'

describe('getIPS', () => {
    it('skips loopback and other internal addresses', () => {
        vi.mocked(networkInterfaces).mockReturnValue({
            lo0: [
                {
                    address: '127.0.0.1',
                    family: 'IPv4',
                    internal: true,
                    netmask: '255.0.0.0',
                    mac: '00:00:00:00:00:00',
                    cidr: '127.0.0.1/8',
                },
            ],
            en0: [
                {
                    address: '192.168.1.10',
                    family: 'IPv4',
                    internal: false,
                    netmask: '255.255.255.0',
                    mac: '00:00:00:00:00:00',
                    cidr: '192.168.1.10/24',
                },
            ],
        })

        expect(getIPS()).toEqual(['192.168.1.10'])
    })

    it('picks a non-internal IPv4 on an interface that also has loopback', () => {
        vi.mocked(networkInterfaces).mockReturnValue({
            en0: [
                {
                    address: '127.0.0.1',
                    family: 'IPv4',
                    internal: true,
                    netmask: '255.0.0.0',
                    mac: '00:00:00:00:00:00',
                    cidr: '127.0.0.1/8',
                },
                {
                    address: '10.0.0.2',
                    family: 'IPv4',
                    internal: false,
                    netmask: '255.255.255.0',
                    mac: '00:00:00:00:00:00',
                    cidr: '10.0.0.2/24',
                },
            ],
        })

        expect(getIPS()).toEqual(['10.0.0.2'])
    })

    it('accepts numeric family 4 from older Node', () => {
        vi.mocked(networkInterfaces).mockReturnValue({
            en0: [
                {
                    address: '10.0.0.2',
                    family: 4 as never,
                    internal: false,
                    netmask: '255.255.255.0',
                    mac: '00:00:00:00:00:00',
                    cidr: '10.0.0.2/24',
                },
            ],
        })

        expect(getIPS()).toEqual(['10.0.0.2'])
    })
})
