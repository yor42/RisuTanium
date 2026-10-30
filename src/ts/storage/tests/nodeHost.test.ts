// @vitest-environment node
/**
 * The optional `HOST` environment variable of the real `server/node/server.cjs`
 * narrows the address it binds. Without it the server listens on every
 * interface. Skipped on a machine with no non-loopback IPv4 interface.
 */
import { networkInterfaces } from 'node:os'
import { afterEach, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const externalAddress = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address

let fixture: NodeServerFixture | undefined

afterEach(async () => {
    await fixture?.stop()
    fixture = undefined
})

async function answers(address: string, port: string): Promise<boolean> {
    try {
        const response = await fetch(`http://${address}:${port}/api/test_auth`, { signal: AbortSignal.timeout(3000) })
        return response.status === 200
    } catch {
        return false
    }
}

describe.skipIf(externalAddress === undefined)('HOST', () => {
    test('S6-T2 HOST=127.0.0.1 refuses the machine\'s other address; unset answers on both', async () => {
        fixture = await startNodeServer({ env: { HOST: '127.0.0.1' } })
        const port = new URL(fixture.baseUrl).port
        expect(await answers('127.0.0.1', port)).toBe(true)
        expect(await answers(externalAddress!, port)).toBe(false)
        await fixture.stop()

        fixture = await startNodeServer()
        const openPort = new URL(fixture.baseUrl).port
        expect(await answers('127.0.0.1', openPort)).toBe(true)
        expect(await answers(externalAddress!, openPort)).toBe(true)
    }, 60_000)
})
